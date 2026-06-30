-- Enforce separation: DMs require dm_employee_id; group channels must not have one.
ALTER TABLE public.project_rooms
  DROP CONSTRAINT IF EXISTS project_rooms_kind_shape;

ALTER TABLE public.project_rooms
  ADD CONSTRAINT project_rooms_kind_shape CHECK (
    (kind = 'dm' AND dm_employee_id IS NOT NULL)
    OR (kind <> 'dm' AND dm_employee_id IS NULL)
  );
