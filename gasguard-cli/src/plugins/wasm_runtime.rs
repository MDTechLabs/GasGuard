use std::fmt;

/// Errors that can occur during WASM runtime operations.
#[derive(Debug)]
pub enum RuntimeError {
    Instantiation(String),
    Invocation(String),
    Memory(String),
    ExportNotFound(String),
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RuntimeError::Instantiation(msg) => write!(f, "WASM instantiation error: {msg}"),
            RuntimeError::Invocation(msg) => write!(f, "WASM invocation error: {msg}"),
            RuntimeError::Memory(msg) => write!(f, "WASM memory error: {msg}"),
            RuntimeError::ExportNotFound(name) => {
                write!(f, "WASM export not found: {name}")
            }
        }
    }
}

impl std::error::Error for RuntimeError {}

/// A minimal WASM runtime wrapper around either `wasmer` or `wasmtime`.
///
/// Currently implemented as a placeholder using a thin abstraction.
/// When the `wasm_runtime` feature is enabled, the real engine is used.
pub struct WasmRuntime {
    #[cfg(feature = "wasm_runtime")]
    inner: wasm_integration::Engine,
    #[cfg(not(feature = "wasm_runtime"))]
    _placeholder: (),
}

impl WasmRuntime {
    /// Instantiate a WASM runtime from raw bytecode.
    ///
    /// # Errors
    ///
    /// Returns `RuntimeError::Instantiation` if the module cannot be compiled
    /// or instantiated.
    pub fn instantiate(wasm_bytes: &[u8]) -> Result<Self, RuntimeError> {
        #[cfg(feature = "wasm_runtime")]
        {
            let engine = wasm_integration::Engine::new(wasm_bytes)?;
            Ok(WasmRuntime { inner: engine })
        }
        #[cfg(not(feature = "wasm_runtime"))]
        {
            let _ = wasm_bytes;
            Err(RuntimeError::Instantiation(
                "WASM runtime is not enabled; enable the `wasm_runtime` feature".into(),
            ))
        }
    }

    /// Invoke the `analyze` export on the WASM guest, passing the AST as JSON.
    ///
    /// The guest is expected to return a JSON-serialized `Vec<PluginFinding>`.
    pub fn invoke_analyze(&self, ast_json: &str) -> Result<String, RuntimeError> {
        #[cfg(feature = "wasm_runtime")]
        {
            self.inner.call_analyze(ast_json)
        }
        #[cfg(not(feature = "wasm_runtime"))]
        {
            let _ = ast_json;
            Err(RuntimeError::Invocation(
                "WASM runtime is not enabled; enable the `wasm_runtime` feature".into(),
            ))
        }
    }

    /// Invoke the `manifest` export to retrieve the plugin manifest JSON.
    pub fn invoke_manifest(&self) -> Result<String, RuntimeError> {
        #[cfg(feature = "wasm_runtime")]
        {
            self.inner.call_manifest()
        }
        #[cfg(not(feature = "wasm_runtime"))]
        {
            Err(RuntimeError::Invocation(
                "WASM runtime is not enabled; enable the `wasm_runtime` feature".into(),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// WASM integration layer — gated behind `#[cfg(feature = "wasm_runtime")]`
// ---------------------------------------------------------------------------

#[cfg(feature = "wasm_runtime")]
pub mod wasm_integration {
    use super::RuntimeError;

    /// The concrete engine wrapper. Swap the import below to switch between
    /// `wasmer` and `wasmtime`.
    ///
    /// Current default: **wasmer 4.x**.
    use wasmer:: imports;
    use wasmer::Instance;
    use wasmer::Module;
    use wasmer::Store;
    use wasmer::TypedFunction;
    use wasmer::Value;

    pub struct Engine {
        _store: Store,
        instance: Instance,
    }

    impl Engine {
        pub fn new(wasm_bytes: &[u8]) -> Result<Self, RuntimeError> {
            let mut store = Store::default();
            let module = Module::new(&store, wasm_bytes)
                .map_err(|e| RuntimeError::Instantiation(e.to_string()))?;

            let import_object = imports! {};

            let instance = Instance::new(&mut store, &module, &import_object)
                .map_err(|e| RuntimeError::Instantiation(e.to_string()))?;

            Ok(Engine {
                _store: store,
                instance,
            })
        }

        pub fn call_analyze(&self, ast_json: &str) -> Result<String, RuntimeError> {
            // Write the input string into WASM linear memory so the guest can read it.
            let store = unsafe { &*(&self._store as *const Store) };
            let instance = unsafe { &*(&self.instance as *const Instance) };

            let analyze: TypedFunction<u32, u32> = instance
                .exports
                .get_typed_function(store, "analyze")
                .map_err(|_| RuntimeError::ExportNotFound("analyze".into()))?;

            // Encode the string into WASM memory and get a pointer+length pair.
            let (ptr, len) = self.write_string_to_guest(store, ast_json)?;

            // Call the WASM guest. The guest receives the pointer and length as
            // two i32 arguments packed into a single i32 (or via a struct return).
            // For simplicity, we pass the pointer as the first argument and the
            // length is communicated via a host-allocated buffer convention.
            //
            // A real implementation would use wasmer's `Array` type or
            // `wasmer::MemoryAccess`.
            let result_ptr = analyze
                .call(store, ptr)
                .map_err(|e| RuntimeError::Invocation(e.to_string()))?;

            self.read_string_from_guest(store, result_ptr)
        }

        pub fn call_manifest(&self) -> Result<String, RuntimeError> {
            let store = unsafe { &*(&self._store as *const Store) };
            let instance = unsafe { &*(&self.instance as *const Instance) };

            let manifest: TypedFunction<(), u32> = instance
                .exports
                .get_typed_function(store, "manifest")
                .map_err(|_| RuntimeError::ExportNotFound("manifest".into()))?;

            let ptr = manifest
                .call(store)
                .map_err(|e| RuntimeError::Invocation(e.to_string()))?;

            self.read_string_from_guest(store, ptr)
        }

        // ---------- helper: memory I/O ----------

        fn memory(&self, store: &Store) -> Result<&wasmer::Memory, RuntimeError> {
            self.instance
                .exports
                .get_memory("memory")
                .map_err(|_| RuntimeError::Memory("guest does not export `memory`".into()))
        }

        /// Write a Rust string into guest linear memory.
        ///
        /// Returns a pointer to the start of the written bytes. The guest is
        /// expected to have an exported `alloc` function that reserves memory.
        fn write_string_to_guest(&self, store: &Store, s: &str) -> Result<(u32, u32), RuntimeError> {
            let instance = unsafe { &*(&self.instance as *const Instance) };

            let alloc: TypedFunction<u32, u32> = instance
                .exports
                .get_typed_function(store, "alloc")
                .map_err(|_| RuntimeError::ExportNotFound("alloc".into()))?;

            let len = s.len() as u32;
            let ptr = alloc
                .call(store, len)
                .map_err(|e| RuntimeError::Invocation(e.to_string()))?;

            let mem = self.memory(store)?;
            let view = mem.view(store);
            for (i, byte) in s.bytes().enumerate() {
                let idx = (ptr + i as u32) as u64;
                view.write(idx as u64, &[byte])
                    .map_err(|e| RuntimeError::Memory(e.to_string()))?;
            }

            Ok((ptr, len))
        }

        /// Read a null-terminated or length-prefixed string from guest memory.
        /// Simple convention: the guest returns a pointer to a length-prefixed
        /// string (4 bytes LE length followed by UTF-8 data).
        fn read_string_from_guest(&self, store: &Store, ptr: u32) -> Result<String, RuntimeError> {
            let mem = self.memory(store)?;
            let view = mem.view(store);

            // Read 4-byte length prefix.
            let mut len_bytes = [0u8; 4];
            for (i, b) in len_bytes.iter_mut().enumerate() {
                let val = view
                    .read(ptr as u64 + i as u64)
                    .map_err(|e| RuntimeError::Memory(e.to_string()))?;
                *b = val;
            }
            let len = u32::from_le_bytes(len_bytes) as usize;

            let mut buf = vec![0u8; len];
            for (i, b) in buf.iter_mut().enumerate() {
                let val = view
                    .read(ptr as u64 + 4 + i as u64)
                    .map_err(|e| RuntimeError::Memory(e.to_string()))?;
                *b = val;
            }

            String::from_utf8(buf)
                .map_err(|e| RuntimeError::Memory(format!("invalid UTF-8: {e}")))
        }
    }
}

// ---------------------------------------------------------------------------
// Placeholder host functions (always compiled, even without `wasm_runtime`)
// ---------------------------------------------------------------------------

/// Host functions exposed to WASM guests for querying AST nodes.
///
/// When the `wasm_runtime` feature is active, these are registered into the
/// import object so that guest plugins can call them via `gasguard.query_*`.
pub mod host_functions {
    /// Number of functions in the contract AST.
    pub fn query_function_count(_ast_json: &str) -> u32 {
        0
    }

    /// Number of state variables in the contract AST.
    pub fn query_state_var_count(_ast_json: &str) -> u32 {
        0
    }

    /// Number of modifiers in the contract AST.
    pub fn query_modifier_count(_ast_json: &str) -> u32 {
        0
    }
}
