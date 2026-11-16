from core.settings_schema import StorageS3
from media import storage


def test_s3_settings_strip_pasted_whitespace():
    c = StorageS3(accessKeyId=" AKIAEXAMPLE ", secretAccessKey="secret\n", bucket=" b ", region=" eu-west-1")
    assert (c.accessKeyId, c.secretAccessKey, c.bucket, c.region) == ("AKIAEXAMPLE", "secret", "b", "eu-west-1")


def test_aws_client_uses_regional_endpoint_for_presigned_urls():
    c = storage._client_for("fp-test", "eu-west-1", "AKIAEXAMPLE", "secret", "", False)
    url = c.generate_presigned_url("get_object", Params={"Bucket": "my-bucket", "Key": "k.jpg"}, ExpiresIn=60)
    assert url.startswith("https://s3.eu-west-1.amazonaws.com/") or url.startswith("https://my-bucket.s3.eu-west-1.amazonaws.com/")
    assert "eu-west-1" in url


def test_custom_endpoint_is_kept():
    c = storage._client_for("fp-test2", "us-east-1", "k", "s", "http://localhost:9000", True)
    assert c.generate_presigned_url("get_object", Params={"Bucket": "b", "Key": "k"}, ExpiresIn=60).startswith("http://localhost:9000/b/k")
