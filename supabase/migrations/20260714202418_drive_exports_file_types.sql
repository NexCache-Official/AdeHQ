-- Allow Word/PowerPoint/conversion export types used by artifact jobs.
alter table public.drive_exports
  drop constraint if exists drive_exports_export_type_check;

alter table public.drive_exports
  add constraint drive_exports_export_type_check
  check (
    export_type in (
      'report',
      'summary',
      'memory',
      'artifact_bundle',
      'document',
      'presentation',
      'artifact_conversion',
      'other'
    )
  );
