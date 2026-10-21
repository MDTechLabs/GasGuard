pub struct Buffer {
    data: [u8; 32],
}

impl Buffer {
    pub fn new() -> Self {
        Buffer { data: [0; 32] }
    }

    pub fn as_array(&self) -> [u8; 32] {
        self.data
    }
}

pub const LIMIT: [u8; 2] = [1, 2];
