-- Group 7. Moscow times. Public visibility; one owner column.
-- Excludes self-study and Russian as a foreign language.
-- Saturday sports: 12:30-13:50, using the previously agreed 80-minute duration.
-- Run in SQL Editor only after write access is restored.
begin;
insert into public.planner_events
(id,title,notes,starts_at,duration_minutes,space,created_by,done,deleted,version,updated_at)
values
('b26e1102-2026-4000-8000-000000000001','Иностранный язык (китайский)','Практическое занятие','2026-11-02 09:00:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000002','Иностранный язык (китайский)','Практическое занятие','2026-11-02 10:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000003','Экономика и внешнеэкономические связи Китая','Лекция · Ауд. 1.401','2026-11-02 12:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000004','Экономика и внешнеэкономические связи Китая','Лекция · Ауд. 1.401','2026-11-02 14:00:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000005','Социально-психологическое тестирование','Ауд. 1.201','2026-11-02 15:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000006','Линейная алгебра','Семинар · Ауд. 1.502','2026-11-05 10:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000007','Математический анализ','Семинар · Ауд. 1.502','2026-11-05 12:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000008','Математический анализ','Семинар · Ауд. 1.502','2026-11-05 14:00:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000009','Математический анализ','Семинар · Ауд. 1.502','2026-11-05 15:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000010','Иностранный язык (китайский)','Практическое занятие','2026-11-06 10:00:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000011','Иностранный язык (китайский)','Практическое занятие','2026-11-06 11:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000012','История России','Семинар · Ауд. 5.404','2026-11-06 13:30:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000013','История России','Семинар · Ауд. 5.404','2026-11-06 15:00:00+03',80,'shared','ksusha',false,false,1,now()),
('b26e1102-2026-4000-8000-000000000014','Физическая культура и спорт','Практическое занятие','2026-11-07 12:30:00+03',80,'shared','ksusha',false,false,1,now())
on conflict (id) do nothing;
commit;

-- Expected: 14 / 14. Repeat execution creates no duplicate IDs.
select count(*) as imported_of_14,
count(*) filter(where space='shared' and not deleted) as visible_shared_of_14
from public.planner_events
where id between 'b26e1102-2026-4000-8000-000000000001'::uuid
and 'b26e1102-2026-4000-8000-000000000014'::uuid;
