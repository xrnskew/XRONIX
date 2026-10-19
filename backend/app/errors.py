MESSAGES = {
    'VALIDATION_ERROR': (400, 'Проверьте введённые данные.'),
    'UNAUTHORIZED': (401, 'Войдите в аккаунт заново.'),
    'INVALID_CREDENTIALS': (401, 'Неверная почта или пароль.'),
    'EMAIL_TAKEN': (409, 'Эта почта уже зарегистрирована.'),
    'NOT_FOUND': (404, 'Запрошенные данные не найдены.'),
    'RATE_LIMITED': (429, 'Слишком много запросов. Попробуйте чуть позже.'),
    'AI_UNAVAILABLE': (502, 'Консультант сейчас недоступен. Попробуйте ещё раз через минуту.'),
    'AI_BAD_RESPONSE': (502, 'Консультант не смог подготовить ответ. Попробуйте ещё раз.'),
    'INTERNAL': (500, 'Не удалось выполнить запрос. Попробуйте позже.'),
}


class ApiError(Exception):
    def __init__(self, code):
        self.code = code
        self.status, self.message = MESSAGES[code]

    def body(self):
        return {'error': {'code': self.code, 'message': self.message}}
