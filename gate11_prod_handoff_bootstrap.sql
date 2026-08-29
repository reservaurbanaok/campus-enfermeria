BEGIN;

CREATE TABLE IF NOT EXISTS public.omega_handoffs (
  handoff_id text NOT NULL,
  conversation_id text NOT NULL,
  status text NOT NULL,
  handoff_context jsonb NOT NULL,
  claimed_by text,
  claimed_at timestamp with time zone,
  resolution jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT omega_handoffs_pkey PRIMARY KEY (handoff_id),
  CONSTRAINT omega_handoffs_status_check CHECK (
    status = ANY (ARRAY[
      'WAITING_HUMAN'::text,
      'HUMAN_ACTIVE'::text,
      'RETURNED_TO_AI'::text,
      'CLOSED'::text,
      'CANCELLED'::text,
      'FAILED'::text
    ])
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS omega_handoffs_one_active_per_conversation
  ON public.omega_handoffs USING btree (conversation_id)
  WHERE (status = ANY (ARRAY['WAITING_HUMAN'::text, 'HUMAN_ACTIVE'::text]));

COMMIT;
