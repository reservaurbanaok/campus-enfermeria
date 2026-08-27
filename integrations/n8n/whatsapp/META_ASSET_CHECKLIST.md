# Gate 07 Meta staging asset checklist

Discovery only. No Meta assets were created or changed in Movement 07B.

| Asset | 07B status | 07C requirement |
|---|---|---|
| Meta Business Portfolio | `NEEDS_OWNER_ACTION` | Owner confirms portfolio and business ownership |
| Meta App | `NEEDS_OWNER_ACTION` | Owner creates/selects a staging app |
| WhatsApp Business Account / WABA | `NEEDS_OWNER_ACTION` | Owner confirms WABA assignment |
| Phone Number ID | `NEEDS_OWNER_ACTION` | Use a non-production test number |
| Access token | `NEEDS_OWNER_ACTION` | Scoped token in n8n credential storage, never Git |
| Webhook verify token | `CAN_BE_CREATED_BY_CODEX` | Generate/store outside Git during 07C |
| HTTPS callback URL | `DEFERRED` | Requires approved staging hosting |
| Permissions | `NEEDS_OWNER_ACTION` | Owner/Meta approval for required scopes |
| Test recipient | `NEEDS_OWNER_ACTION` | Synthetic/approved test recipient only |
| WABA webhook subscription | `DEFERRED` | Configure once staging app and callback exist |

No access token, WABA ID, phone number or real message was used in 07B.


