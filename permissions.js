'use strict';

// Single source of truth for server-side role capabilities.
const ROLE_PERMISSIONS = Object.freeze({
  user: Object.freeze(['customer', 'support.own', 'support.reply']),
  agent: Object.freeze(['agent.workspace', 'support.assigned', 'support.reply']),
  admin: Object.freeze(['admin.workspace', 'admin.manage', 'support.all', 'support.reply', 'audit.read']),
  superadmin: Object.freeze([
    'admin.workspace', 'admin.manage', 'support.all', 'money.decide',
    'agents.manage', 'referrals.reassign', 'settlements.manage', 'audit.read', 'support.reply'
  ])
});

function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.includes(permission));
}

module.exports = { ROLE_PERMISSIONS, hasPermission };
