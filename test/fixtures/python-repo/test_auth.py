from auth import authenticate


def test_authenticate():
    assert authenticate("abc")["user"] == "abc"
