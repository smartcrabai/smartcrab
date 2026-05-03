+++
title = "Storage"
description = "Storage 仕様 — Node 間で状態を共有する非同期 Key-Value ストレージ"
weight = 5
+++

# sakoku-ignore-next-line
## 概要

# sakoku-ignore-next-line
`Storage` は Graph 内の Node 間で状態を共有し、複数回の実行をまたいで状態を保持するための非同期 Key-Value ストアである。`Arc<dyn Storage>` 型で Node に渡す。

# sakoku-ignore-next-line
## `Storage` トレイト

# sakoku-ignore-next-line
生の文字列 Key-Value 操作を提供するコアトレイト:

```rust
#[async_trait]
pub trait Storage: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<String>>;
    async fn set(&self, key: &str, value: String) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<bool>;
    async fn keys(&self, prefix: Option<&str>) -> Result<Vec<String>>;
}
```

# sakoku-ignore-next-line
| メソッド | 説明 |
|--------|-------------|
# sakoku-ignore-next-line
| `get(key)` | `key` の値を返す。存在しない場合は `None` |
# sakoku-ignore-next-line
| `set(key, value)` | `key` に `value` を保存する |
# sakoku-ignore-next-line
| `delete(key)` | `key` を削除する。存在した場合は `true` を返す |
# sakoku-ignore-next-line
| `keys(prefix)` | 全キーを返す。`prefix` を指定するとプレフィックスでフィルタリング |

# sakoku-ignore-next-line
## `StorageExt` トレイト

# sakoku-ignore-next-line
JSON 型付きヘルパーを提供する拡張トレイト。`Storage` を実装する全ての型（`Arc<dyn Storage>` を含む）に自動実装される。

```rust
pub trait StorageExt: Storage {
    async fn get_typed<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>>;
    async fn set_typed<T: Serialize>(&self, key: &str, value: &T) -> Result<()>;
}
```

# sakoku-ignore-next-line
| メソッド | 説明 |
|--------|-------------|
# sakoku-ignore-next-line
| `get_typed::<T>(key)` | 保存された JSON 文字列を `T` にデシリアライズして返す |
# sakoku-ignore-next-line
| `set_typed(key, value)` | `value` を JSON にシリアライズして保存する |

# sakoku-ignore-next-line
## 組み込みバックエンド

# sakoku-ignore-next-line
### `InMemoryStorage`

# sakoku-ignore-next-line
`HashMap` をバックエンドとするインメモリストア。インスタンスが破棄されるとデータは失われる。テストや一時的なワークフローに適している。

```rust
let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());
```

# sakoku-ignore-next-line
### `FileStorage`

# sakoku-ignore-next-line
JSON ファイルに永続化するファイルバックエンドストア。書き込みはアトミック（`.tmp` ファイルへの書き込み後にリネーム）なので、クラッシュ時でも不完全な書き込みが残らない。

```rust
let storage: Arc<dyn Storage> = Arc::new(FileStorage::open("data/state.json").await?);
```

# sakoku-ignore-next-line
## Graph との接続

# sakoku-ignore-next-line
ストレージインスタンスを Node のコンストラクタに直接渡すか、`DirectedGraphBuilder` に設定する:

```rust
# sakoku-ignore-next-line
// Node コンストラクタ経由での注入（Node 内の型付きアクセスに推奨）
let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());

let graph = DirectedGraphBuilder::new("my_pipeline")
    .add_input(ReadCount { storage: Arc::clone(&storage) })
    .add_hidden(IncrementCount { storage: Arc::clone(&storage) })
    .add_output(PrintCount)
    .add_edge("ReadCount", "IncrementCount")
    .add_edge("IncrementCount", "PrintCount")
    .build()?;
```

# sakoku-ignore-next-line
## 使用例: 複数回実行をまたいだカウンター

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

# sakoku-ignore-next-line
## エラー種別

# sakoku-ignore-next-line
Storage のエラーは `SmartCrabError::Storage` でラップされる:

# sakoku-ignore-next-line
| バリアント | 原因 |
|---------|-------|
# sakoku-ignore-next-line
| `StorageError::Io` | ファイル I/O エラー |
# sakoku-ignore-next-line
| `StorageError::Serialization` | JSON シリアライズ失敗 |
# sakoku-ignore-next-line
| `StorageError::Deserialization` | JSON デシリアライズ失敗 |
# sakoku-ignore-next-line
| `StorageError::FileCorrupted` | 保存された JSON ファイルが壊れている |
