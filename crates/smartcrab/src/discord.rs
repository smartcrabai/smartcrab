use std::sync::Arc;

use async_trait::async_trait;
use poise::serenity_prelude::{self as serenity, FullEvent, GatewayIntents};
use tracing::{error, info};

use crate::chat::ChatGateway;
use crate::chat::discord::DiscordMessage;
use crate::error::{Result, SmartCrabError};
use crate::graph::{DirectedGraph, TriggerKind};

type PoiseError = Box<dyn std::error::Error + Send + Sync>;

struct PoiseData {
    /// (trigger patterns, graph) pairs for Chat-triggered graphs.
    graphs: Vec<(Vec<String>, Arc<DirectedGraph>)>,
    /// Pre-computed `<@BOT_ID>` string for mention detection.
    mention_pattern: String,
    /// Pre-computed `<@!BOT_ID>` string for nickname-mention detection.
    mention_nick_pattern: String,
}

/// Discord gateway that connects to Discord via Poise/serenity.
///
/// Implements [`ChatGateway`] so the Runtime can dispatch chat graphs to
/// Discord without depending on Discord directly.
pub struct DiscordGateway {
    token: String,
}

impl DiscordGateway {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
        }
    }
}

#[async_trait]
impl ChatGateway for DiscordGateway {
    fn platform(&self) -> &str {
        "discord"
    }

    async fn run(&self, graphs: Vec<Arc<DirectedGraph>>) -> Result<()> {
        run_poise(graphs, self.token.clone()).await
    }
}

/// Run a Poise framework for all Chat-triggered graphs.
///
/// Connects to the Discord gateway using the provided token and dispatches
/// incoming messages to matching graphs via `run_with_trigger()`.
pub(crate) async fn run_poise(graphs: Vec<Arc<DirectedGraph>>, token: String) -> Result<()> {
    if graphs.is_empty() {
        return std::future::pending().await;
    }

    let mut graph_triggers: Vec<(Vec<String>, Arc<DirectedGraph>)> = Vec::new();
    for graph in &graphs {
        if let Some(TriggerKind::Chat { triggers, .. }) = graph.trigger_kind() {
            graph_triggers.push((triggers.clone(), Arc::clone(graph)));
            info!(graph = %graph.name(), triggers = ?triggers, "registered chat graph");
        }
    }

    if graph_triggers.is_empty() {
        return std::future::pending().await;
    }

    let framework = poise::Framework::builder()
        .setup(move |_ctx, ready, _framework| {
            info!(user = %ready.user.name, "Discord bot connected");
            let bot_id = ready.user.id.to_string();
            Box::pin(async move {
                Ok(PoiseData {
                    graphs: graph_triggers,
                    mention_pattern: format!("<@{bot_id}>"),
                    mention_nick_pattern: format!("<@!{bot_id}>"),
                })
            })
        })
        .options(poise::FrameworkOptions {
            event_handler: |ctx, event, framework, data| {
                Box::pin(event_handler(ctx, event, framework, data))
            },
            ..Default::default()
        })
        .build();

    let intents = GatewayIntents::non_privileged() | GatewayIntents::MESSAGE_CONTENT;

    let mut client = serenity::ClientBuilder::new(&token, intents)
        .framework(framework)
        .await
        .map_err(|e| SmartCrabError::Chat {
            platform: "discord".into(),
            message: format!("failed to create Discord client: {e}"),
        })?;

    client.start().await.map_err(|e| SmartCrabError::Chat {
        platform: "discord".into(),
        message: format!("Discord client error: {e}"),
    })?;

    Ok(())
}

async fn event_handler(
    ctx: &serenity::Context,
    event: &FullEvent,
    _framework: poise::FrameworkContext<'_, PoiseData, PoiseError>,
    data: &PoiseData,
) -> std::result::Result<(), PoiseError> {
    if let FullEvent::Message { new_message } = event {
        // Skip messages from bots (including ourselves).
        if new_message.author.bot {
            return Ok(());
        }

        let bot_id = ctx.cache.current_user().id;

        // A bot can be @-mentioned in three ways:
        //   1. Direct user mention   → message.mentions contains the bot user
        //   2. Content-embedded      → "<@BOT_ID>" or "<@!BOT_ID>" in content
        //   3. Integration role mention → "<@&ROLE_ID>" where that role belongs
        //      to the bot (Discord creates a managed role for every bot).
        let mention_in_array = new_message.mentions_user_id(bot_id);
        let mention_in_content = new_message.content.contains(&data.mention_pattern)
            || new_message.content.contains(&data.mention_nick_pattern);

        // For role mentions, fetch the bot's own member to compare its roles.
        let mention_via_role = !new_message.mention_roles.is_empty() && {
            match new_message.guild_id {
                Some(guild_id) => guild_id
                    .member(&ctx, bot_id)
                    .await
                    .map(|m| {
                        m.roles
                            .iter()
                            .any(|r| new_message.mention_roles.contains(r))
                    })
                    .unwrap_or(false),
                None => false,
            }
        };

        let is_mention = mention_in_array || mention_in_content || mention_via_role;
        let is_dm = new_message.guild_id.is_none();

        info!(
            author             = %new_message.author.name,
            bot_id             = %bot_id,
            is_mention,
            mention_in_array,
            mention_in_content,
            mention_via_role,
            is_dm,
            mentions_count     = new_message.mentions.len(),
            mention_roles      = ?new_message.mention_roles,
            content_head       = %new_message.content.chars().take(60).collect::<String>(),
            "message received"
        );

        for (triggers, graph) in &data.graphs {
            let should_trigger = triggers.iter().any(|t| match t.as_str() {
                "mention" => is_mention,
                "dm" => is_dm,
                _ => false,
            });

            if should_trigger {
                let msg = DiscordMessage {
                    channel_id: new_message.channel_id.to_string(),
                    author: new_message.author.name.clone(),
                    content: new_message.content.clone(),
                    is_mention,
                    is_dm,
                };

                let graph = Arc::clone(graph);
                let name = graph.name().to_owned();
                // Run graph asynchronously so we don't block the event handler.
                tokio::spawn(async move {
                    info!(graph = %name, "chat trigger fired");
                    if let Err(e) = graph.run_with_trigger(Box::new(msg)).await {
                        error!(graph = %name, error = %e, "chat graph execution failed");
                    }
                });
            }
        }
    }

    Ok(())
}
