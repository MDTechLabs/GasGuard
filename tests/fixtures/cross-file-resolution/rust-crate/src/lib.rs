pub mod math;
mod storage;

use crate::math::add;
pub use storage::Store;

pub fn total(a: u64, b: u64) -> u64 {
    // add is called here; math::sub too
    add(a, b) - math::sub(b, a)
}
