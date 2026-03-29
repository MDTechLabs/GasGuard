use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
use property_token::{
    execute_set_metadata,
    msg::{Auth, PropertyMetadata},
    state::ADMIN,
};

fn mock_metadata() -> PropertyMetadata {
    PropertyMetadata {
        name: "Test Property".to_string(),
        description: "A test property".to_string(),
        image_url: None,
    }
}

#[test]
fn test_replay_attack_prevented() {
    let mut deps = mock_dependencies();
    ADMIN.save(deps.as_mut().storage, &"user".to_string()).unwrap();

    let auth = Auth {
        nonce: 0,
        expires_at: None,
        tx_id: None,
    };

    let metadata = mock_metadata();

    // First call should succeed
    let res1 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token1".to_string(),
        metadata.clone(),
        auth.clone(),
    );
    assert!(res1.is_ok());

    // Replay same nonce should fail
    let res2 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token1".to_string(),
        metadata,
        auth,
    );
    assert!(res2.is_err());
    let err = res2.unwrap_err().to_string();
    assert!(err.contains("ReplayDetected"), "expected ReplayDetected, got: {}", err);
}

#[test]
fn test_tx_id_deduplication() {
    let mut deps = mock_dependencies();
    ADMIN.save(deps.as_mut().storage, &"user".to_string()).unwrap();

    let auth1 = Auth {
        nonce: 0,
        expires_at: None,
        tx_id: Some("tx-abc-123".to_string()),
    };
    let auth2 = Auth {
        nonce: 1,
        expires_at: None,
        tx_id: Some("tx-abc-123".to_string()), // same tx_id, different nonce
    };

    let metadata = mock_metadata();

    let res1 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token1".to_string(),
        metadata.clone(),
        auth1,
    );
    assert!(res1.is_ok());

    // Second call with same tx_id but incremented nonce should still fail
    let res2 = execute_set_metadata(
        deps.as_mut(),
        mock_env(),
        mock_info("user", &[]),
        "token2".to_string(),
        metadata,
        auth2,
    );
    assert!(res2.is_err());
    let err = res2.unwrap_err().to_string();
    assert!(err.contains("ReplayDetected"), "expected ReplayDetected, got: {}", err);
}
