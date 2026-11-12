from core.integrations.google_maps import plus_code, short_plus_code


def test_plus_code_reference_vectors():
    # From the Open Location Code test suite.
    assert plus_code(47.365590, 8.524997) == "8FVC9G8F+6X"
    assert plus_code(20.3700625, 2.7821875) == "7FG49QCJ+2V"


def test_short_code_drops_area_prefix():
    assert short_plus_code(-6.7712, 39.2399) == plus_code(-6.7712, 39.2399)[4:]
    assert "+" in short_plus_code(-6.7712, 39.2399)
