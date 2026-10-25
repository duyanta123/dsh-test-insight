def authenticate(token):
    if not token:
        raise ValueError("missing token")
    return {"user": token}
