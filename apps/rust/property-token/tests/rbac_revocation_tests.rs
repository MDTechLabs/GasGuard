use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
use property_token::{
    execute_update_config,
    instantiate,
    query_self_check,
    msg::InstantiateMsg,
    state::AUTHORIZED_ROLES,
};

fn attr_value(response: &cosmwasm_std::Response, key: &str) -> Option<String> {
    response
        .attributes
        .iter()
        .find(|attr| attr.key == key)
        .map(|attr| attr.value.clone())
}

#[test]
fn revoking_a_role_removes_the_storage_entry_and_emits_audit_attributes() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();
    AUTHORIZED_ROLES
        .save(deps.as_mut().storage, "operator", &true)
        .unwrap();

    let response = execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        None,
        Some(vec![("operator".to_string(), false)]),
    )
    .unwrap();

    assert_eq!(AUTHORIZED_ROLES.may_load(deps.as_ref().storage, "operator").unwrap(), None);
    assert_eq!(attr_value(&response, "roles_revoked_count").as_deref(), Some("1"));
    assert_eq!(attr_value(&response, "roles_revoked").as_deref(), Some("operator"));
    assert_eq!(attr_value(&response, "actor").as_deref(), Some("admin"));
}

#[test]
fn revoking_a_missing_role_is_rejected() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();

    let err = execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        None,
        Some(vec![("ghost".to_string(), false)]),
    )
    .unwrap_err()
    .to_string();

    assert!(err.contains("Cannot revoke role for ghost"), "unexpected error: {}", err);
}

#[test]
fn legacy_false_role_entries_are_cleaned_by_revocation_and_self_check_passes() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();
    AUTHORIZED_ROLES
        .save(deps.as_mut().storage, "legacy-role", &false)
        .unwrap();

    execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        None,
        Some(vec![("legacy-role".to_string(), false)]),
    )
    .unwrap();

    let report = query_self_check(deps.as_ref()).unwrap();
    assert!(report.ok, "expected self check to pass, got failures: {:?}", report.failures);
}

#[test]
fn unauthorized_callers_cannot_revoke_roles() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();
    AUTHORIZED_ROLES
        .save(deps.as_mut().storage, "operator", &true)
        .unwrap();

    let err = execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("attacker", &[]),
        None,
        Some(vec![("operator".to_string(), false)]),
    )
    .unwrap_err()
    .to_string();

    assert!(err.contains("Only the current admin can update config"), "unexpected error: {}", err);
    assert_eq!(AUTHORIZED_ROLES.may_load(deps.as_ref().storage, "operator").unwrap(), Some(true));
}

#[test]
fn empty_admin_updates_are_rejected_to_preserve_admin_control() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();

    let err = execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        Some("   ".to_string()),
        None,
    )
    .unwrap_err()
    .to_string();

    assert!(err.contains("new_admin cannot be empty"), "unexpected error: {}", err);
}

#[test]
fn duplicate_role_updates_are_rejected_before_state_changes() {
    let mut deps = mock_dependencies();
    instantiate(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        InstantiateMsg { admin: None },
    )
    .unwrap();

    let err = execute_update_config(
        deps.as_mut(),
        mock_env(),
        mock_info("admin", &[]),
        None,
        Some(vec![
            ("operator".to_string(), true),
            ("operator".to_string(), false),
        ]),
    )
    .unwrap_err()
    .to_string();

    assert!(err.contains("Duplicate role update requested for operator"), "unexpected error: {}", err);
    assert_eq!(AUTHORIZED_ROLES.may_load(deps.as_ref().storage, "operator").unwrap(), None);
}