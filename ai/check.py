import os
from dotenv import load_dotenv
from gigachat import GigaChat

load_dotenv()

with GigaChat(
    credentials=os.environ["GIGACHAT_AUTH_KEY"],
    scope=os.environ["GIGACHAT_SCOPE"],
    model=os.environ.get("GIGACHAT_MODEL", "GigaChat"),
    ca_bundle_file=os.environ["GIGACHAT_CA_BUNDLE_FILE"],
timeout=60,
) as giga:
    giga.get_token()
    print("1. Авторизация OK")

    models = giga.get_models()
    print("2. Модели:", [m.id_ for m in models.data])

    resp = giga.chat("Привет! Ответь одним словом.")
    print("3. Ответ:", resp.choices[0].message.content)