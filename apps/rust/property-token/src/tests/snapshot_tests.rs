#[test]
fn test_create_snapshot() {
    let mut deps = mock_dependencies();

    // insert metadata
    METADATA.save(
        deps.as_mut().storage,
        "token1",
        &mock_metadata(),
    ).unwrap();

    let res = execute_create_snapshot(
        deps.as_mut(),
        mock_env(),
        mock_info("owner", &[]),
    );

    assert!(res.is_ok());

    let snapshot = SNAPSHOTS.load(deps.as_ref().storage, 1).unwrap();
    assert_eq!(snapshot.len(), 1);
}