from core.integrations.beem import _GSM, _plain, to_gsm


def test_smart_punctuation_becomes_plain():
    assert to_gsm("SmartWear test message — your SMS works…") == "SmartWear test message - your SMS works..."
    assert to_gsm("“Karibu” ‘rafiki’") == "\"Karibu\" 'rafiki'"


def test_plain_text_and_gsm_letters_untouched():
    msg = "123456 is your SmartWear code. It expires in 5 minutes.\nAbC123xyz"
    assert to_gsm(msg) == msg
    assert to_gsm("Café für Ñandú") == "Cafe fur Nandu"


def test_accents_stripped_and_emoji_dropped():
    assert to_gsm("Ofa kubwa ✨ leo – São Tomé ç") == "Ofa kubwa leo - Sao Tome c"
    assert all(c in _GSM for c in to_gsm("🔥🎉 Drop ya leo! 🛍️"))


def test_beem_html_error_is_plain():
    assert _plain("Enable <strong>Allow Unicode</strong> checkbox") == "Enable Allow Unicode checkbox"


def test_render_template_accepts_single_double_and_spaced_braces():
    from core.integrations.beem import render_template

    assert render_template("Code {code}, {{ minutes }} min, {{Code}}", code="123456", minutes=5) == "Code 123456, 5 min, 123456"
    assert render_template("Hi {{name}} {unknown}", name="Asha") == "Hi Asha {unknown}"


def test_otp_message_always_contains_the_code():
    from accounts.otp import otp_message

    assert otp_message("Your verification code is {code}, it expire in {minutes} Min", "482913", 5) == "Your verification code is 482913, it expire in 5 Min"
    assert otp_message("{{code}} is your SmartWear code. It expires in {{minutes}} minutes.\n{{appHash}}", "111222", 5, "FA+9qCX9VSu") == "111222 is your SmartWear code. It expires in 5 minutes.\nFA+9qCX9VSu"
    assert otp_message("Tumia {otp} / {PIN}", "999000", 5) == "Tumia 999000 / 999000"
    assert otp_message("Welcome to SmartWear", "555444", 5) == "Welcome to SmartWear\nCode: 555444"
    assert otp_message("Welcome\n{{appHash}}", "555444", 5, "HASH123abcd") == "Welcome\nCode: 555444\nHASH123abcd"
    assert otp_message("", "555444", 5) == "Your SmartWear code is 555444. It expires in 5 minutes."
