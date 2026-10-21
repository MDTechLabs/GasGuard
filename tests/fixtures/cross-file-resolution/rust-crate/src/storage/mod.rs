use super::math::{add, sub as minus};
use std::collections::HashMap;

pub struct Store {
    items: HashMap<u64, u64>,
}

impl Store {
    pub fn bump(&mut self, key: u64) -> u64 {
        let next = add(key, 1);
        minus(next, 1)
    }
}
