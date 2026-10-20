import re


def valid_inn(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[0-9]{10}|[0-9]{12})', value):
        return False
    n = list(map(int, value))
    def check(weights):
        return sum(a*b for a, b in zip(n, weights)) % 11 % 10
    return check([2,4,10,3,5,9,4,6,8]) == n[9] if len(n) == 10 else check([7,2,4,10,3,5,9,4,6,8]) == n[10] and check([3,7,2,4,10,3,5,9,4,6,8]) == n[11]


def valid_ogrn(value):
    if not isinstance(value,str) or not re.fullmatch(r'(?:[0-9]{13}|[0-9]{15})',value):
        return False
    return int(value[:-1])%(13 if len(value)==15 else 11)%10==int(value[-1])
