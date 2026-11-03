import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'dashboard'))
import plugin_api as api


def test_folder_upload_defaults_persistence_and_owner_profile_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(api, '_workspace_root', lambda: tmp_path)
    read = api._attachment_preferences
    assert read('alice', 'default') == {'folderUploadEnabled': False}
    assert read('alice', 'default', api.AttachmentPreferencesBody(folderUploadEnabled=True)) == {'folderUploadEnabled': True}
    assert read('alice', 'default')['folderUploadEnabled']
    assert not read('bob', 'default')['folderUploadEnabled']
    assert not read('alice', 'writer')['folderUploadEnabled']
    assert not read('alice', 'default', api.AttachmentPreferencesBody(folderUploadEnabled=False))['folderUploadEnabled']
