"""From backend/: python -m app.export_openapi ../contracts/openapi.json"""
import json
import sys
from pathlib import Path
from .config import Settings
from .main import create_app


def main():
    destination=Path(sys.argv[1]) if len(sys.argv)>1 else Path('../contracts/openapi.json')
    settings=Settings(database_url='sqlite://',jwt_secret='openapi-export-only-not-a-runtime-secret',seed_demo=False)
    schema=create_app(settings).app.openapi()
    destination.write_text(json.dumps(schema,ensure_ascii=False,indent=2)+'\n')
    print(f'{destination}: {len(schema["paths"])} paths')


if __name__=='__main__':main()
