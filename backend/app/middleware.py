import json

from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.exc import SQLAlchemyError, OperationalError

from .errors import ApiError
from .limits import consume, sqlite_busy


class ApiCORS(CORSMiddleware):
    """Reject foreign browser origins before side effects; bound bodies and request rate."""
    def __init__(self, app, settings, sessions):
        super().__init__(app, allow_origins=settings.cors_origins,
                         allow_methods=['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
                         allow_headers=['Authorization', 'Content-Type'])
        self.settings, self.sessions = settings, sessions

    def failure(self, code, origin=None):
        error = ApiError(code)
        headers = {'Retry-After': '60'} if code == 'RATE_LIMITED' else {}
        if origin and self.is_allowed_origin(origin):
            headers.update({'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'})
        return JSONResponse(error.body(), status_code=error.status, headers=headers)

    def preflight_response(self, request_headers):
        response = super().preflight_response(request_headers)
        if response.status_code == 400:
            return self.failure('VALIDATION_ERROR', request_headers.get('origin'))
        return response

    def admit(self, peer, path):
        with self.sessions() as session:
            consume(session, 'api-ip', peer, self.settings.api_requests_per_minute)
            if path.startswith('/api/auth/'):
                consume(session, 'auth-ip', peer, self.settings.auth_requests_per_minute)
            session.commit()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await super().__call__(scope, receive, send)
        headers = Headers(scope=scope)
        origin = headers.get('origin')
        if origin and not self.is_allowed_origin(origin):
            return await self.failure('VALIDATION_ERROR')(scope, receive, send)
        if scope['path'].startswith('/api/') and scope['method'] != 'OPTIONS':
            try:
                peer = (scope.get('client') or ('unknown', 0))[0]
                await run_in_threadpool(self.admit, peer, scope['path'])
            except SQLAlchemyError as exc:
                code = 'RATE_LIMITED' if isinstance(exc, OperationalError) and sqlite_busy(exc) else 'INTERNAL'
                return await self.failure(code, origin)(scope, receive, send)
            except ApiError as exc:
                return await self.failure(exc.code, origin)(scope, receive, send)
            if scope['method'] in ('POST', 'PATCH'):
                body = bytearray()
                while True:
                    event = await receive()
                    if event['type'] == 'http.disconnect':
                        return
                    body.extend(event.get('body', b''))
                    if len(body) > self.settings.max_body_bytes:
                        return await self.failure('VALIDATION_ERROR', origin)(scope, receive, send)
                    if not event.get('more_body', False):
                        break
                if body:
                    try:
                        def reject_constant(value):
                            raise ValueError('Non-finite JSON number')
                        decoded = json.loads(body, parse_constant=reject_constant)
                        json.dumps(decoded, ensure_ascii=False).encode('utf-8')
                    except (ValueError, RecursionError):
                        return await self.failure('VALIDATION_ERROR', origin)(scope, receive, send)
                original_receive = receive
                delivered = False

                async def replay():
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                    return await original_receive()

                receive = replay
        return await super().__call__(scope, receive, send)
