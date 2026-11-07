"""Regression for Fleet's actual integer artifact IDs at the UI boundary."""
import pytest
from fastapi import HTTPException
from dashboard.standalone_domains.fleet import public_artifact


def test_integer_artifact_identity_remains_downloadable():
    value = public_artifact({"id": 42, "task_id": "T-example", "name": "result.txt"}, "T-example")
    assert value["id"] == "42"
    assert value["download_url"].endswith("/42/download?task_id=T-example")


@pytest.mark.parametrize("artifact_id", [True, False, 0, -1, None])
def test_invalid_artifact_identity_is_rejected(artifact_id):
    with pytest.raises(HTTPException):
        public_artifact({"id": artifact_id, "task_id": "T-example"}, "T-example")


def test_artifact_cannot_change_owning_task():
    with pytest.raises(HTTPException) as error:
        public_artifact({"id": 42, "task_id": "T-foreign"}, "T-example")
    assert error.value.status_code == 502
