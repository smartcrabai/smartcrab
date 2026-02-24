use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use crate::error::{Result, SmartCrabError};

/// Initialize OpenTelemetry tracing with OTLP exporter and fmt layer.
///
/// This sets up a global tracing subscriber with:
/// - An OTLP span exporter (gRPC/tonic)
/// - A human-readable fmt layer (with target, level, file, line number)
/// - An env-filter controlled by `RUST_LOG`
pub fn init() -> Result<()> {
    let otlp_exporter = SpanExporter::builder()
        .with_tonic()
        .build()
        .map_err(|e| SmartCrabError::Telemetry(e.to_string()))?;

    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(otlp_exporter)
        .build();
    let tracer = provider.tracer("smartcrab");

    let telemetry = tracing_opentelemetry::layer().with_tracer(tracer);
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_level(true)
        .with_file(true)
        .with_line_number(true);

    tracing_subscriber::registry()
        .with(telemetry)
        .with(fmt_layer)
        .with(EnvFilter::from_default_env())
        .init();

    Ok(())
}
