//! Closes #668: bytecode mutation engine (starter) for gas-spike fuzzing.
//! Flips bytes in compiled runtime opcodes to generate mutated variants for
//! gas-runner execution against warm/cold storage state. No external deps.

/// Deterministic xorshift-style generator, avoids pulling in the `rand` crate
/// for this starter implementation.
struct SimpleRng(u64);

impl SimpleRng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

/// Produces `count` mutated copies of `bytecode`, each with a single byte
/// flipped at a pseudo-random offset.
pub fn mutate_bytecode(bytecode: &[u8], count: usize, seed: u64) -> Vec<Vec<u8>> {
    if bytecode.is_empty() {
        return Vec::new();
    }
    let mut rng = SimpleRng(seed | 1);
    let mut variants = Vec::with_capacity(count);
    for _ in 0..count {
        let mut mutated = bytecode.to_vec();
        let idx = (rng.next() as usize) % mutated.len();
        mutated[idx] ^= 0xFF;
        variants.push(mutated);
    }
    variants
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_requested_variant_count() {
        let variants = mutate_bytecode(&[0x60, 0x01, 0x60, 0x02], 5, 42);
        assert_eq!(variants.len(), 5);
    }

    #[test]
    fn empty_input_yields_no_variants() {
        assert!(mutate_bytecode(&[], 3, 1).is_empty());
    }
}
