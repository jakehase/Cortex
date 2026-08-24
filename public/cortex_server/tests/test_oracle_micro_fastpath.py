from cortex_server.routers.oracle import _strict_micro_fast_answer


def test_number_only_fastpath_arithmetic():
    out = _strict_micro_fast_answer("What is 2+2? Reply number only.")
    assert out == "4"


def test_yes_no_fastpath_water_wet():
    out = _strict_micro_fast_answer("Is water wet? Reply yes/no.")
    assert out in {"yes", "no"}
    assert out == "yes"


def test_one_word_fastpath_planet():
    out = _strict_micro_fast_answer("Reply one word naming a planet.")
    assert out == "earth"
