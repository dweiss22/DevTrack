begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000011','admin@example.test'),
  ('00000000-0000-0000-0000-000000000012','member@example.test'),
  ('00000000-0000-0000-0000-000000000013','other@example.test');
insert into public.organizations(id,name,reporting_access_enforced) values
  ('00000000-0000-0000-0000-000000000021','Test organization',false),
  ('00000000-0000-0000-0000-000000000022','Other organization',true);
insert into public.application_users(id,organization_id,display_name,role) values
  ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','Admin','admin'),
  ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000021','Member','member'),
  ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000022','Other','admin');
insert into public.wrike_users(id,organization_id,wrike_id,display_name) values
  ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021','WU1','Worker'),
  ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000021','WU2','Other worker');
insert into public.wrike_tasks(id,organization_id,wrike_id,title,status) values
  ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021','WT1','Visible task','Active'),
  ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000022','WT2','Other task','Active');
insert into public.wrike_sync_scopes(id,organization_id,scope_type,source_ids,label) values
  ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000021','folder',array['WF1'],'Test scope');
insert into public.wrike_scope_tasks(scope_id,task_id) values
  ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000041');
insert into public.reporting_groups(id,organization_id,name,match_mode) values
  ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000021','Intersection group','intersection');
insert into public.reporting_group_members(group_id,application_user_id) values
  ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000012');
insert into public.reporting_group_scopes(group_id,scope_id) values
  ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000051');
insert into public.reporting_group_wrike_users(group_id,wrike_user_id) values
  ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000031');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'compatibility mode permits organization records');
select is((select count(*) from public.wrike_tasks where organization_id='00000000-0000-0000-0000-000000000022'),0::bigint,'cross-organization tasks remain hidden');

reset role;
update public.organizations set reporting_access_enforced=true where id='00000000-0000-0000-0000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),0::bigint,'intersection requires both dimensions');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'organization administrators retain reporting-wide access');

reset role;
update public.reporting_groups set match_mode='union' where id='00000000-0000-0000-0000-000000000061';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'union grants access when the source dimension matches');

reset role;
update public.reporting_groups set match_mode='intersection' where id='00000000-0000-0000-0000-000000000061';
insert into public.wrike_task_assignees(task_id,user_id) values
  ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000031');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'intersection grants access after source and person match');

reset role;
delete from public.reporting_group_wrike_users where group_id='00000000-0000-0000-0000-000000000061';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'source-only groups use their source restriction');

reset role;
insert into public.reporting_group_wrike_users(group_id,wrike_user_id) values ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000031');
delete from public.reporting_group_scopes where group_id='00000000-0000-0000-0000-000000000061';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_tasks),1::bigint,'people-only groups use their people restriction');

reset role;
insert into public.reporting_group_scopes(group_id,scope_id) values ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000051');
insert into public.wrike_time_entries(id,organization_id,wrike_id,task_id,user_id,entry_date,minutes) values
  ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000021','WE1','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000031',current_date,60),
  ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000021','WE2','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000032',current_date,30);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.wrike_time_entries),1::bigint,'timelog visibility independently requires the entry author match');

reset role;
insert into public.wrike_custom_fields(id,organization_id,wrike_id,title,field_type) values ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000021','CF1','[LCT]','DropDown');
insert into public.wrike_enabled_custom_fields(organization_id,custom_field_id) values ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000091');
insert into public.wrike_task_custom_field_values(task_id,custom_field_id,value,text_value,option_ids) values ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000091','"Course"'::jsonb,'Course',array['OPT1']);
insert into public.wrike_normalized_custom_fields(id,organization_id,normalized_key,title) values ('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000021','course type','Course Type');
insert into public.wrike_normalized_custom_field_sources(normalized_field_id,custom_field_id,source_designation) values ('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000091','M');
insert into public.wrike_task_normalized_custom_field_values(task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values) values ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000092',array['Course'],array['CF1'],array['[LCT] Course Type (M)'],'[]'::jsonb);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.reporting_task_rows('{"customFields":{"00000000-0000-0000-0000-000000000092":"Course"}}'::jsonb,50,0)),1::bigint,'logical custom fields filter authorized tasks across raw sources');
select is((select count(*) from public.reporting_custom_field_options()),1::bigint,'dynamic custom-field options contain only values on visible tasks');

reset role;
insert into public.reporting_conversations(id,organization_id,user_id,title) values
  ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000012','Member history');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select is((select count(*) from public.reporting_conversations),1::bigint,'member can read own conversation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select is((select count(*) from public.reporting_conversations),1::bigint,'administrator can audit organization conversations');

reset role;
insert into public.reporting_messages(conversation_id,organization_id,user_id,role,content,created_at) values ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000012','user','Old question',now() - interval '91 days');
select public.cleanup_reporting_messages(90);
select is((select count(*) from public.reporting_messages where content='Old question'),0::bigint,'cleanup removes reporting messages older than 90 days');

select * from finish();
rollback;
