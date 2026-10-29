import unittest
from tools.package_branch_schedule import order_ready_branches
class ScheduleTests(unittest.TestCase):
    def test_cold_and_completed(self):
        rows=[{'branchId':b,'status':'queued'} for b in ['aiVideo','camera','captions','templates','cover','footage']]
        self.assertEqual(order_ready_branches(rows,{}),['footage','cover','templates','captions','camera','aiVideo'])
        rows[0]['status']='complete'
        self.assertNotIn('aiVideo',order_ready_branches(rows,{}))
    def test_animation_priority_and_history(self):
        rows=[{'branchId':'footage'},{'branchId':'templates','animationDeliveryRelevant':True},{'branchId':'cover'}]
        self.assertEqual(order_ready_branches(rows,{}),['templates','footage','cover'])
        rows[1].pop('animationDeliveryRelevant')
        self.assertEqual(order_ready_branches(rows,{'cover':[30,30,30],'footage':[9,9,9]}),['cover','footage','templates'])
    def test_three_slot_fixture_finishes_in_nine_units(self):
        import heapq
        durations={'templates':2,'footage':9,'aiVideo':1,'camera':2,'captions':2,'cover':8}
        order=order_ready_branches([{'branchId':b} for b in durations],{})
        slots=[0,0,0]
        for branch in order:
            available=heapq.heappop(slots);heapq.heappush(slots,available+durations[branch])
        self.assertEqual(max(slots),9)

    def test_current_cold_queue_starts_bgm_in_third_slot(self):
        rows=[{'branchId':b} for b in ['aiVideo','camera','captions','bgm','cover','footage']]
        self.assertEqual(order_ready_branches(rows,{}),['footage','cover','bgm','captions','camera','aiVideo'])
        self.assertEqual(order_ready_branches(rows,{'camera':[20,20,20]}),['camera','footage','cover','bgm','captions','aiVideo'])
