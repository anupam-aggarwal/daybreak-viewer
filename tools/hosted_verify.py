"""Read and validate the current private hosted snapshot and every file."""
import base64, copy, sys, uuid
from pathlib import Path
from hosted_api import API
from hosted_backup import encoded, digest
from daybreak import validate

def recover(api, owner):
    owner=str(uuid.UUID(owner))
    pointers=api.call('/rest/v1/daybreak_workspaces?select=revision&owner_id=eq.'+owner)
    if len(pointers)!=1: raise ValueError('Workspace pointer missing')
    revision=pointers[0]['revision']
    snapshots=api.call(f'/rest/v1/daybreak_snapshots?select=*&owner_id=eq.{owner}&revision=eq.{revision}')
    if len(snapshots)!=1: raise ValueError('Snapshot missing')
    snapshot=snapshots[0];data=copy.deepcopy(snapshot['document'])
    files=api.call('/rest/v1/daybreak_files?select=*&owner_id=eq.'+owner)
    mapping={f['id']:f for f in files}
    for artifact in data['artifacts']:
        f=mapping[artifact['id']]
        if f['path']!=owner+'/'+artifact['sha256'] or f['sha256']!=artifact['sha256'] or f['mime']!=artifact['mime'] or f['filename']!=artifact['name']:
            raise ValueError('Registry mismatch')
        raw=api.call('/storage/v1/object/authenticated/daybreak-private/'+f['path'],raw=True)
        if len(raw)!=f['size'] or digest(raw)!=artifact['sha256']: raise ValueError('File integrity failure')
        artifact['base64']=base64.b64encode(raw).decode()
    validate(data)
    if data['meta']['revision']!=revision or digest(encoded(data))!=snapshot['canonical_sha256']:
        raise ValueError('Snapshot integrity failure')
    return data
