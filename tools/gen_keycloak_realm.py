"""Generates infra/keycloak/oralscreen-realm.json from services/app/bootstrap/demo_world.py, so user ids and
facility ids in Keycloak match the database seed exactly.   python tools/gen_keycloak_realm.py"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services"))
from app.bootstrap.demo_world import DEMO_PASSWORD, STAFF, fid, uid  # noqa: E402

ROLES = {"asha": "ASHA / community health worker", "nurse": "PHC staff nurse",
         "specialist": "Oral medicine specialist", "clinical_lead": "Clinical lead (approves rules & models)",
         "district_officer": "District health officer (aggregates only)", "admin": "Platform administrator"}

profile = {
    "attributes": [
        {"name": "username", "displayName": "${username}",
         "validations": {"length": {"min": 3, "max": 255}, "username-prohibited-characters": {}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "email", "displayName": "${email}", "validations": {"email": {}, "length": {"max": 255}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "firstName", "displayName": "${firstName}", "validations": {"length": {"max": 255}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "lastName", "displayName": "${lastName}", "validations": {"length": {"max": 255}},
         "permissions": {"view": ["admin", "user"], "edit": ["admin"]}, "multivalued": False},
        {"name": "facility_id", "displayName": "Facility (UUID)",
         "permissions": {"view": ["admin"], "edit": ["admin"]}, "multivalued": False},
    ],
    "groups": [], "unmanagedAttributePolicy": "ADMIN_EDIT",
}


def user(username, full, role, fcode):
    first, _, last = full.partition(" ")
    u = {"id": uid(username), "username": username, "enabled": True, "emailVerified": True,
         "email": f"{username}@oralscreen.demo", "firstName": first, "lastName": last or "-",
         "credentials": [{"type": "password", "value": DEMO_PASSWORD, "temporary": False}],
         "realmRoles": [role, "default-roles-oralscreen"], "requiredActions": []}
    if fcode:
        u["attributes"] = {"facility_id": [fid(fcode)]}
    return u


realm = {
    "realm": "oralscreen", "enabled": True, "displayName": "OralScreen",
    "sslRequired": "none", "registrationAllowed": False, "loginWithEmailAllowed": False,
    "bruteForceProtected": True, "failureFactor": 5, "maxFailureWaitSeconds": 900, "permanentLockout": False,
    "passwordPolicy": "length(10) and upperCase(1) and digits(1) and specialChars(1) and notUsername",
    "accessTokenLifespan": 1800, "ssoSessionIdleTimeout": 28800, "ssoSessionMaxLifespan": 86400,
    "offlineSessionIdleTimeout": 2592000,           # the ASHA phone keeps working offline for up to 30 days
    "eventsEnabled": True, "adminEventsEnabled": True, "adminEventsDetailsEnabled": True,
    "roles": {"realm": [{"name": r, "description": d} for r, d in ROLES.items()]},
    "clients": [{
        "clientId": "oralscreen-app", "name": "OralScreen apps (phone, specialist console, dashboards)",
        "enabled": True, "publicClient": True, "protocol": "openid-connect",
        "standardFlowEnabled": True, "directAccessGrantsEnabled": True, "implicitFlowEnabled": False,
        "redirectUris": ["https://localhost/*", "http://localhost:*/*", "oralscreen://callback"],
        "webOrigins": ["+"], "attributes": {"pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "+"},
        "protocolMappers": [{
            "name": "facility_id", "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper",
            "config": {"user.attribute": "facility_id", "claim.name": "facility_id", "jsonType.label": "String",
                       "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true",
                       "multivalued": "false"}}],
    }],
    "users": [user(*s) for s in STAFF],
    "components": {"org.keycloak.userprofile.UserProfileProvider": [{
        "providerId": "declarative-user-profile", "subComponents": {},
        "config": {"kc.user.profile.config": [json.dumps(profile)]}}]},
}
out = ROOT / "infra" / "keycloak" / "oralscreen-realm.json"
out.write_text(json.dumps(realm, indent=2, ensure_ascii=False))
print("wrote", out)
