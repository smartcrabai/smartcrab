+++
title = "Chat"
description = "Chat 仕様 — ChatClient・ChatGateway トレイト、Discord 連携、テスト用モック"
weight = 6
+++

# sakoku-ignore-next-line
## 概要

# sakoku-ignore-next-line
SmartCrab はチャットプラットフォームとの連携に 2 つのトレイトを提供する:

# sakoku-ignore-next-line
- **`ChatClient`**: 送信側 — チャンネルにメッセージを投稿する
# sakoku-ignore-next-line
- **`ChatGateway`**: 受信側 — プラットフォームのリアルタイムイベントストリームに接続し、受信メッセージを Graph にディスパッチする

# sakoku-ignore-next-line
## `ChatClient` トレイト

```rust
#[async_trait]
pub trait ChatClient: Send + Sync + 'static {
    async fn send_message(&self, channel: &str, content: &str) -> Result<()>;
}
```

# sakoku-ignore-next-line
| メソッド | 説明 |
|--------|-------------|
# sakoku-ignore-next-line
| `send_message(channel, content)` | 指定した `channel` に `content` を送信する |

# sakoku-ignore-next-line
### Output Node での使用例

```rust
struct DiscordNotifier {
    client: Arc<dyn ChatClient>,
}

#[async_trait]
impl OutputNode for DiscordNotifier {
    type Input = NotificationDto;

    async fn run(&self, input: Self::Input) -> Result<()> {
        self.client
            .send_message(&input.channel_id, &input.message)
            .await
    }
}
```

# sakoku-ignore-next-line
## `ChatGateway` トレイト

```rust
#[async_trait]
pub trait ChatGateway: Send + Sync + 'static {
    fn platform(&self) -> &str;
    async fn run(&self, graphs: Vec<Arc<DirectedGraph>>) -> Result<()>;
}
```

# sakoku-ignore-next-line
| メソッド | 説明 |
|--------|-------------|
# sakoku-ignore-next-line
| `platform()` | プラットフォーム識別子を返す（例: `"discord"`, `"slack"`） |
# sakoku-ignore-next-line
| `run(graphs)` | プラットフォームに接続し、受信イベントを登録された Graph にディスパッチする |

# sakoku-ignore-next-line
## 組み込み実装: Discord

# sakoku-ignore-next-line
### `DiscordClient`

# sakoku-ignore-next-line
Discord REST API（`POST /channels/{id}/messages`）でメッセージを送信する。

```rust
let client = DiscordClient::new("BOT_TOKEN");
client.send_message("CHANNEL_ID", "Hello from SmartCrab!").await?;
```

# sakoku-ignore-next-line
`DiscordNotification` を使う便利ラッパー `send_notification` も提供している:

```rust
let notification = DiscordNotification {
    channel_id: "CHANNEL_ID".to_string(),
    content: "Hello!".to_string(),
};
client.send_notification(&notification).await?;
```

# sakoku-ignore-next-line
### Discord DTO

# sakoku-ignore-next-line
| 型 | フィールド | 説明 |
|------|--------|-------------|
# sakoku-ignore-next-line
| `DiscordMessage` | `channel_id`, `author`, `content`, `is_mention`, `is_dm` | Discord から受信したメッセージ |
# sakoku-ignore-next-line
| `DiscordNotification` | `channel_id`, `content` | Discord への送信通知 |

# sakoku-ignore-next-line
`DiscordMessage::stripped_content(bot_id)` は、メッセージ内容からボットのメンションプレフィックスを除去した文字列を返す。

# sakoku-ignore-next-line
## テスト用モック

# sakoku-ignore-next-line
### `MockChatClient`

# sakoku-ignore-next-line
送信した全メッセージをメモリに記録し、テストでのアサーションに使用できる。

```rust
let mock = MockChatClient::new();
let client: Arc<dyn ChatClient> = Arc::new(mock.clone());

// sakoku-ignore-next-line
// ... Graph を実行 ...

let sent = mock.sent_messages();
assert_eq!(sent[0], ("general".to_string(), "Hello!".to_string()));
```

# sakoku-ignore-next-line
`sent_messages()` は送信した全メッセージを `Vec<(channel, content)>` で返す。

# sakoku-ignore-next-line
### `MockChatGateway`

# sakoku-ignore-next-line
外部プラットフォームへの接続なしに、登録された全 Graph を即座に 1 回実行する。結合テストに適している。

```rust
let gateway = MockChatGateway::new("discord");
gateway.run(vec![Arc::new(graph)]).await?;
```
