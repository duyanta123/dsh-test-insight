from service.convert import to_text


def test_to_text():
    assert to_text(None) == ""
