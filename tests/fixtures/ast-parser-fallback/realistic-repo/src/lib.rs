pub struct Counter {
    value: u64,
}

impl Counter {
    pub fn bump(&mut self) {
        self.value += 1;
    }
}
