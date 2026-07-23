-- PR-18.2A2: provider-neutral employee voice identities.
--
-- voiceIdentityKey is the durable AdeHQ identity. Provider bindings can rotate
-- without changing how a member perceives the employee.

alter table public.ai_employees
  alter column voice_profile set default '{
    "voiceEnabled": true,
    "voiceIdentityKey": "",
    "locale": "en",
    "tone": "professional",
    "pace": 1,
    "routePreference": "auto",
    "premiumVoiceAllowed": false,
    "providerBindings": []
  }'::jsonb;

update public.ai_employees
set voice_profile =
  coalesce(voice_profile, '{}'::jsonb)
  || jsonb_build_object(
    'voiceEnabled', coalesce((voice_profile->>'voiceEnabled')::boolean, true),
    'voiceIdentityKey',
      coalesce(
        nullif(voice_profile->>'voiceIdentityKey', ''),
        'employee-' || id
      ),
    'locale', coalesce(nullif(voice_profile->>'locale', ''), 'en'),
    'tone',
      coalesce(
        nullif(voice_profile->>'tone', ''),
        nullif(voice_profile->>'voiceStyle', ''),
        'professional'
      ),
    'pace',
      coalesce(
        (voice_profile->>'pace')::numeric,
        (voice_profile->>'speakingRate')::numeric,
        1
      ),
    'routePreference',
      coalesce(nullif(voice_profile->>'routePreference', ''), 'auto'),
    'providerBindings',
      case
        when jsonb_typeof(voice_profile->'providerBindings') = 'array'
          and jsonb_array_length(voice_profile->'providerBindings') > 0
          then voice_profile->'providerBindings'
        else jsonb_build_array(
          jsonb_build_object(
            'provider', 'xai',
            'voiceId',
              (array['eve', 'ara', 'leo', 'rex', 'sal'])[
                1 + (
                  (
                    ('x' || substr(md5(id), 1, 8))::bit(32)::bigint
                  ) % 5
                )::integer
              ],
            'qualityTier', 'standard'
          )
        )
      end
  )
where
  voice_profile->>'voiceIdentityKey' is null
  or voice_profile->>'voiceIdentityKey' = ''
  or jsonb_typeof(voice_profile->'providerBindings') is distinct from 'array'
  or jsonb_array_length(coalesce(voice_profile->'providerBindings', '[]'::jsonb)) = 0;

create or replace function public.set_ai_employee_voice_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.voice_profile :=
    coalesce(new.voice_profile, '{}'::jsonb)
    || jsonb_build_object(
      'voiceEnabled', coalesce((new.voice_profile->>'voiceEnabled')::boolean, true),
      'voiceIdentityKey',
        coalesce(
          nullif(new.voice_profile->>'voiceIdentityKey', ''),
          'employee-' || new.id
        ),
      'locale', coalesce(nullif(new.voice_profile->>'locale', ''), 'en'),
      'tone',
        coalesce(
          nullif(new.voice_profile->>'tone', ''),
          nullif(new.voice_profile->>'voiceStyle', ''),
          'professional'
        ),
      'pace',
        coalesce(
          (new.voice_profile->>'pace')::numeric,
          (new.voice_profile->>'speakingRate')::numeric,
          1
        ),
      'routePreference',
        coalesce(nullif(new.voice_profile->>'routePreference', ''), 'auto'),
      'providerBindings',
        case
          when jsonb_typeof(new.voice_profile->'providerBindings') = 'array'
            and jsonb_array_length(new.voice_profile->'providerBindings') > 0
            then new.voice_profile->'providerBindings'
          else jsonb_build_array(
            jsonb_build_object(
              'provider', 'xai',
              'voiceId',
                (array['eve', 'ara', 'leo', 'rex', 'sal'])[
                  1 + (
                    (
                      ('x' || substr(md5(new.id), 1, 8))::bit(32)::bigint
                    ) % 5
                  )::integer
                ],
              'qualityTier', 'standard'
            )
          )
        end
    );
  return new;
end;
$$;

drop trigger if exists trg_ai_employees_voice_identity on public.ai_employees;
create trigger trg_ai_employees_voice_identity
before insert or update of voice_profile, id on public.ai_employees
for each row execute function public.set_ai_employee_voice_identity();

alter table public.ai_employees
  drop constraint if exists ai_employees_voice_profile_shape_check;

alter table public.ai_employees
  add constraint ai_employees_voice_profile_shape_check check (
    jsonb_typeof(voice_profile) = 'object'
    and coalesce(voice_profile->>'voiceIdentityKey', '') <> ''
    and coalesce(voice_profile->>'locale', '') <> ''
    and coalesce((voice_profile->>'pace')::numeric, 1) between 0.7 and 1.5
    and coalesce(voice_profile->>'routePreference', 'auto')
      in ('auto', 'standard', 'premium', 'local')
    and jsonb_typeof(coalesce(voice_profile->'providerBindings', '[]'::jsonb)) = 'array'
  ) not valid;

alter table public.ai_employees
  validate constraint ai_employees_voice_profile_shape_check;
