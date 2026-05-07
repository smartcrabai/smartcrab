+++
title = "Storage"
description = "Storage spec — asynchronous key-value storage shared between Nodes"
weight = 5
+++

## Overview

`Storage` is an asynchronous key-value store that allows state to be shared between Nodes within a Graph across multiple runs. It is exposed to Nodes via the `Arc<dyn Storage>` type.

## `Storage` Trait

The core trait providing raw string key-value operations:

```rust
#[async_trait]
pub trait Storage: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<String>>;
    async fn set(&self, key: &str, value: String) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<bool>;
    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>>;
}
```

| Method | Description |
|--------|-------------|
| `get(key)` | Returns the value for `key`, or `None` if not found |
| `set(key, value)` | Stores `value` under `key` |
| `delete(key)` | Removes `key`; returns `true` if it existed |
| `keys(prefix)` | Lists all keys, optionally filtered by prefix |

## `StorageExt` Trait

Extension trait providing JSON-typed helpers. Automatically implemented for every type that implements `Storage`, including `Arc<dyn Storage>`.

```rust
pub trait StorageExt: Storage {
    async fn get_typed<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>>;
    async fn set_typed<T: Serialize>(&self, key: &str, value: &T) -> Result<()>;
}
```

| Method | Description |
|--------|-------------|
| `get_typed::<T>(key)` | Deserializes the stored JSON string into `T` |
| `set_typed(key, value)` | Serializes `value` to JSON and stores it |

## Built-in Backends

### `InMemoryStorage`

An in-memory store backed by a `HashMap`. Data is lost when the instance is dropped. Suitable for testing or ephemeral workflows.

```rust
let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());
```

### `FileStorage`

A file-backed store persisted as a JSON file. Writes are atomic — the file is written to a `.tmp` sibling and renamed, preventing partial writes on crash.

```rust
let storage: Arc<dyn Storage> = Arc::new(FileStorage::open("data/state.json").await?);
```

## Connecting to a Graph

Pass the storage instance to `DirectedGraphBuilder::storage()`, or inject it directly into Node constructors:

```rust
// Inject via Node constructor (recommended for typed access within a Node)
let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());

let graph = DirectedGraphBuilder::new("my_pipeline")
    .add_input(ReadCount { storage: Arc::clone(&storage) })
    .add_hidden(IncrementCount { storage: Arc::clone(&storage) })
    .add_output(PrintCount)
    .add_edge("ReadCount", "IncrementCount")
    .add_edge("IncrementCount", "PrintCount")
    .build()?;
```

## Example: Counter Across Runs

```rust
use std::sync::Arc;
use smartcrab::prelude::*;

struct ReadCount { storage: Arc<dyn Storage> }

impl Node for ReadCount {
    fn name(&self) -> &str { "ReadCount" }
}

#[async_trait]
impl InputNode for ReadCount {
    type TriggerData = ();
    type Output = Count;

    async fn run(&self, _: ()) -> Result<Count> {
        let n = self.storage
            .get("counter").await?
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        Ok(Count(n))
    }
}

struct IncrementCount { storage: Arc<dyn Storage> }

impl Node for IncrementCount {
    fn name(&self) -> &str { "IncrementCount" }
}

#[async_trait]
impl HiddenNode for IncrementCount {
    type Input = Count;
    type Output = Count;

    async fn run(&self, input: Count) -> Result<Count> {
        let new = input.0 + 1;
        self.storage.set("counter", new.to_string()).await?;
        Ok(Count(new))
    }
}
```

## Error Types

Storage errors are wrapped in `SmartCrabError::Storage`:

| Variant | Cause |
|---------|-------|
| `StorageError::Io` | File I/O failure |
| `StorageError::Serialization` | JSON serialization failure |
| `StorageError::Deserialization` | JSON deserialization failure |
| `StorageError::FileCorrupted` | Stored JSON file is malformed |
