-- 0002_templates.sql — Layer C: presentation configuration (structured, never arbitrary HTML/CSS/JS).
-- A template edit NEVER mutates an existing chart: charts pin template_version_id (§9 pinning).
-- chart_templates is station-shared (OPEN_QUESTIONS T12 default).

CREATE TABLE chart_templates (
  template_id   bigserial PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  is_default    boolean NOT NULL DEFAULT FALSE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE template_versions (
  template_version_id bigserial PRIMARY KEY,
  template_id   bigint NOT NULL REFERENCES chart_templates(template_id),
  labels        jsonb NOT NULL DEFAULT '{}',     -- node-key → { label, short_form? }  (e.g. "srpi.title" → "वपोनि")
  layout        jsonb NOT NULL DEFAULT '{}',     -- node-key → { align_h, align_v, width_mode, span, visibility, order }
  note          text,
  created_by    text,                            -- kept for future RBAC (T9); any clerk for MVP
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, created_at)
);

-- One blessed default template version chain; charts pin specific versions.
CREATE INDEX template_versions_template_idx ON template_versions(template_id, template_version_id DESC);
