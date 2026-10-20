import httpx
from jsonschema import ValidationError
from .errors import ApiError
from .inn import valid_ogrn


class Integrations:
    def __init__(self, url, contracts, client):
        self.url, self.contracts, self.client = url, contracts, client

    async def request(self, kind, inn):
        try:
            if kind=='bki':
                response=await self.client.post(self.url+'/bki/report',json=dict(inn=inn,consent=True),timeout=5)
            else:
                response=await self.client.get(self.url+f'/{kind}/{inn}',timeout=5)
            response.raise_for_status()
            data=response.json()
            self.contracts.validate('integrations',data,'bki_report' if kind=='bki' else kind)
            if kind=='egrul' and not valid_ogrn(data.get('ogrn')):
                raise ValueError('Invalid OGRN')
            if data['inn'] != inn:
                raise ValueError('Wrong INN')
            return data
        except (httpx.HTTPError,ValueError,ValidationError):
            raise ApiError('INTEGRATION_UNAVAILABLE') from None
