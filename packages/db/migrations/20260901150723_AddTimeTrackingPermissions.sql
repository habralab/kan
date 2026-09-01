-- Backfill new permissions for existing system roles. Custom roles and explicit
-- permission rows are intentionally left unchanged.
INSERT INTO "workspace_role_permissions" (
	"workspaceRoleId",
	"permission",
	"granted",
	"createdAt"
)
SELECT wr.id, permissions.permission, true, NOW()
FROM "workspace_roles" wr
INNER JOIN (
	VALUES
		('admin', 'worklog:view'),
		('admin', 'worklog:create'),
		('admin', 'worklog:edit'),
		('admin', 'worklog:delete'),
		('admin', 'worklog:manage'),
		('member', 'worklog:view'),
		('member', 'worklog:create'),
		('member', 'worklog:edit'),
		('member', 'worklog:delete')
) AS permissions(role_name, permission)
	ON permissions.role_name = wr.name
WHERE wr."isSystem" = true
ON CONFLICT ("workspaceRoleId", "permission") DO NOTHING;
