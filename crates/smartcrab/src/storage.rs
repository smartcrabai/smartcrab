use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::sync::RwLock;

use crate::error::{Result, SmartCrabError, StorageError};

/// Object-safe async key-value storage abstraction.
///
/// Use [`StorageExt`] for typed (JSON) helpers.
#[async_trait]
pub trait Storage: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<String>>;
    async fn set(&self, key: &str, value: String) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<bool>;
    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>>;
}

/// Extension trait providing JSON-typed helpers on top of [`Storage`].
///
/// Automatically implemented for every type that implements [`Storage`],
/// including `Arc<dyn Storage>`.
#[expect(async_fn_in_trait)]
pub trait StorageExt: Storage {
    async fn get_typed<T: DeserializeOwned + Send>(&self, key: &str) -> Result<Option<T>> {
        match self.get(key).await? {
            Some(s) => serde_json::from_str::<T>(&s).map(Some).map_err(|e| {
                SmartCrabError::Storage(StorageError::Deserialization {
                    key: key.to_owned(),
                    source: e,
                })
            }),
            None => Ok(None),
        }
    }

    async fn set_typed<T: Serialize + Send + Sync>(&self, key: &str, value: &T) -> Result<()> {
        let s = serde_json::to_string(value).map_err(|e| {
            SmartCrabError::Storage(StorageError::Serialization {
                key: key.to_owned(),
                source: e,
            })
        })?;
        self.set(key, s).await
    }
}

impl<S: Storage> StorageExt for S {}

/// Forward all [`Storage`] calls through an `Arc<dyn Storage>`.
#[async_trait]
impl Storage for Arc<dyn Storage> {
    async fn get(&self, key: &str) -> Result<Option<String>> {
        (**self).get(key).await
    }

    async fn set(&self, key: &str, value: String) -> Result<()> {
        (**self).set(key, value).await
    }

    async fn delete(&self, key: &str) -> Result<bool> {
        (**self).delete(key).await
    }

    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>> {
        (**self).keys(prefix).await
    }
}

/// In-memory storage backend backed by a `RwLock<HashMap>`.
///
/// Data is lost when the instance is dropped. Useful for testing or
/// ephemeral workflows.
#[derive(Default)]
pub struct InMemoryStorage {
    data: RwLock<HashMap<String, String>>,
}

impl InMemoryStorage {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Storage for InMemoryStorage {
    async fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.data.read().await.get(key).cloned())
    }

    async fn set(&self, key: &str, value: String) -> Result<()> {
        self.data.write().await.insert(key.to_owned(), value);
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<bool> {
        Ok(self.data.write().await.remove(key).is_some())
    }

    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>> {
        let guard = self.data.read().await;
        Ok(match prefix {
            Some(p) => guard.keys().filter(|k| k.starts_with(p)).cloned().collect(),
            None => guard.keys().cloned().collect(),
        })
    }
}

/// File-backed storage persisted as a single JSON file.
///
/// Writes are atomic: data is serialized to a `.tmp` sibling file, then
/// renamed over the target path so that a crash never leaves a partially
/// written file.
pub struct FileStorage {
    path: PathBuf,
    data: RwLock<HashMap<String, String>>,
}

impl FileStorage {
    /// Open (or create) the storage file at `path`.
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be read or parsed, or if
    /// any I/O error occurs during opening.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_owned();
        let data = match tokio::fs::read_to_string(&path).await {
            Ok(raw) => serde_json::from_str::<HashMap<String, String>>(&raw).map_err(|e| {
                SmartCrabError::Storage(StorageError::FileCorrupted {
                    path: path.clone(),
                    source: e,
                })
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => return Err(SmartCrabError::Storage(StorageError::Io(e))),
        };
        Ok(Self {
            path,
            data: RwLock::new(data),
        })
    }

    async fn flush(&self, data: &HashMap<String, String>) -> Result<()> {
        let tmp = self.path.with_extension("tmp");
        let contents = serde_json::to_string(data).map_err(|e| {
            SmartCrabError::Storage(StorageError::Serialization {
                key: "<file>".to_owned(),
                source: e,
            })
        })?;
        tokio::fs::write(&tmp, &contents)
            .await
            .map_err(|e| SmartCrabError::Storage(StorageError::Io(e)))?;
        tokio::fs::rename(&tmp, &self.path)
            .await
            .map_err(|e| SmartCrabError::Storage(StorageError::Io(e)))?;
        Ok(())
    }
}

#[async_trait]
impl Storage for FileStorage {
    async fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.data.read().await.get(key).cloned())
    }

    async fn set(&self, key: &str, value: String) -> Result<()> {
        let mut guard = self.data.write().await;
        guard.insert(key.to_owned(), value);
        self.flush(&guard).await
    }

    async fn delete(&self, key: &str) -> Result<bool> {
        let mut guard = self.data.write().await;
        let removed = guard.remove(key).is_some();
        if removed {
            self.flush(&guard).await?;
        }
        Ok(removed)
    }

    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>> {
        let guard = self.data.read().await;
        Ok(match prefix {
            Some(p) => guard.keys().filter(|k| k.starts_with(p)).cloned().collect(),
            None => guard.keys().cloned().collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde::{Deserialize, Serialize};

    use super::*;

    async fn run_basic_storage_tests(
        storage: &impl Storage,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        // set / get
        storage.set("key1", "value1".to_owned()).await?;
        assert_eq!(storage.get("key1").await?, Some("value1".to_owned()));

        // missing key returns None
        assert_eq!(storage.get("missing").await?, None);

        // delete existing key returns true
        assert!(storage.delete("key1").await?);
        assert_eq!(storage.get("key1").await?, None);

        // delete missing key returns false
        assert!(!storage.delete("key1").await?);

        // prefix filtering
        storage.set("ns:a", "1".to_owned()).await?;
        storage.set("ns:b", "2".to_owned()).await?;
        storage.set("other:c", "3".to_owned()).await?;

        let mut prefixed = storage.keys(Some("ns:")).await?;
        prefixed.sort();
        assert_eq!(prefixed, vec!["ns:a", "ns:b"]);

        let all = storage.keys(None).await?;
        assert_eq!(all.len(), 3);
        Ok(())
    }

    async fn run_typed_storage_tests(
        storage: &impl StorageExt,
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        #[derive(Debug, PartialEq, Serialize, Deserialize)]
        struct Payload {
            count: u32,
            name: String,
        }

        let val = Payload {
            count: 42,
            name: "hello".to_owned(),
        };
        storage.set_typed("typed", &val).await?;

        let got: Option<Payload> = storage.get_typed("typed").await?;
        assert_eq!(
            got,
            Some(Payload {
                count: 42,
                name: "hello".to_owned()
            })
        );

        let missing: Option<Payload> = storage.get_typed("no_such_key").await?;
        assert_eq!(missing, None);
        Ok(())
    }

    #[tokio::test]
    async fn test_in_memory_basic() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let s = InMemoryStorage::new();
        run_basic_storage_tests(&s).await
    }

    #[tokio::test]
    async fn test_in_memory_typed() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let s = InMemoryStorage::new();
        run_typed_storage_tests(&s).await
    }

    #[tokio::test]
    async fn test_file_storage_basic() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("storage.json");
        let s = FileStorage::open(&path).await?;
        run_basic_storage_tests(&s).await
    }

    #[tokio::test]
    async fn test_file_storage_typed() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("typed.json");
        let s = FileStorage::open(&path).await?;
        run_typed_storage_tests(&s).await
    }

    #[tokio::test]
    async fn test_file_storage_persistence() -> std::result::Result<(), Box<dyn std::error::Error>>
    {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("persist.json");

        {
            let s = FileStorage::open(&path).await?;
            s.set("greeting", "hello".to_owned()).await?;
            s.set("count", "42".to_owned()).await?;
        }

        {
            let s = FileStorage::open(&path).await?;
            assert_eq!(s.get("greeting").await?, Some("hello".to_owned()));
            assert_eq!(s.get("count").await?, Some("42".to_owned()));
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_arc_dyn_storage_delegates() -> std::result::Result<(), Box<dyn std::error::Error>>
    {
        let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());
        storage.set("k", "v".to_owned()).await?;
        assert_eq!(storage.get("k").await?, Some("v".to_owned()));
        assert!(storage.delete("k").await?);
        assert_eq!(storage.get("k").await?, None);
        Ok(())
    }

    #[tokio::test]
    async fn test_arc_dyn_storage_ext() -> std::result::Result<(), Box<dyn std::error::Error>> {
        let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());
        storage.set_typed("num", &99u32).await?;
        let v: Option<u32> = storage.get_typed("num").await?;
        assert_eq!(v, Some(99u32));
        Ok(())
    }
}
