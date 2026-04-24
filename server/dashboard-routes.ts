import type { Express } from 'express';
import { db } from './db';
import { rfpRequests, bidCollections, properties, projectActuals } from '@shared/schema';
import { and, eq, lt, gte, lte, notInArray, inArray, isNotNull } from 'drizzle-orm';
import { requireAuth } from './middleware';

const parseTiValue = (val: any): number => {
  if (!val) return 0;
  const parsed = parseFloat(val.toString().replace(/[^0-9.]/g, ''));
  return isNaN(parsed) ? 0 : parsed;
};

const INACTIVE_STATUSES = ['completed', 'on-hold', 'archived'];
const ACTIVE_STATUSES = ['received', 'in-progress'];

export function registerDashboardRoutes(app: Express): void {
  app.get('/api/dashboard/metrics', requireAuth, async (req, res) => {
    try {
      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const currentYear = now.getFullYear();
      const priorYear = currentYear - 1;

      // --- 1. Overdue RFPs ---
      const overdueRows = await db
        .select({
          id: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          tenantName: rfpRequests.tenantName,
          propertyId: rfpRequests.propertyId,
          internalDueDate: rfpRequests.internalDueDate,
        })
        .from(rfpRequests)
        .where(
          and(
            lt(rfpRequests.internalDueDate, now),
            notInArray(rfpRequests.status, INACTIVE_STATUSES)
          )
        );

      const overdueRfps = overdueRows
        .map(r => ({
          ...r,
          daysOverdue: Math.floor((now.getTime() - r.internalDueDate.getTime()) / 86400000),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue)
        .slice(0, 20);

      // --- 2. Bids awaiting evaluation ---
      const bidsRows = await db
        .select({
          bidCollectionId: bidCollections.id,
          rfpId: bidCollections.rfpId,
          rfpNumber: rfpRequests.rfpNumber,
          contractorName: bidCollections.contractorName,
          submissionDate: bidCollections.submissionDate,
          createdAt: bidCollections.createdAt,
        })
        .from(bidCollections)
        .innerJoin(rfpRequests, eq(bidCollections.rfpId, rfpRequests.id))
        .where(
          and(
            inArray(bidCollections.status, ['received', 'under-review']),
            notInArray(rfpRequests.status, INACTIVE_STATUSES)
          )
        );

      const bidsAwaitingEvaluation = bidsRows
        .map(r => {
          const baseDate = r.submissionDate ?? r.createdAt;
          return {
            bidCollectionId: r.bidCollectionId,
            rfpId: r.rfpId,
            rfpNumber: r.rfpNumber,
            contractorName: r.contractorName,
            submissionDate: r.submissionDate,
            daysWaiting: Math.floor((now.getTime() - baseDate.getTime()) / 86400000),
          };
        })
        .sort((a, b) => b.daysWaiting - a.daysWaiting)
        .slice(0, 20);

      // --- 3. Upcoming deadlines (next 7 days) ---
      const upcomingRows = await db
        .select({
          id: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          tenantName: rfpRequests.tenantName,
          propertyId: rfpRequests.propertyId,
          internalDueDate: rfpRequests.internalDueDate,
        })
        .from(rfpRequests)
        .where(
          and(
            gte(rfpRequests.internalDueDate, now),
            lte(rfpRequests.internalDueDate, sevenDaysFromNow),
            notInArray(rfpRequests.status, INACTIVE_STATUSES)
          )
        );

      const upcomingDeadlines = upcomingRows
        .map(r => ({
          ...r,
          daysUntilDue: Math.floor((r.internalDueDate.getTime() - now.getTime()) / 86400000),
        }))
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
        .slice(0, 20);

      // --- 4 & 5. Active RFPs for pipeline ---
      const activeRfps = await db
        .select({
          id: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          tenantName: rfpRequests.tenantName,
          propertyId: rfpRequests.propertyId,
          estimatedValue: rfpRequests.estimatedValue,
        })
        .from(rfpRequests)
        .where(inArray(rfpRequests.status, ACTIVE_STATUSES));

      const activeRfpCount = activeRfps.length;
      const totalActiveTiValue = activeRfps.reduce((sum, r) => sum + parseTiValue(r.estimatedValue), 0);

      // --- 6. byProperty: group active RFPs by propertyId, join for name ---
      const propIds = [
        ...new Set(
          activeRfps
            .map(r => r.propertyId)
            .filter((id): id is number => id !== null && id !== undefined)
        ),
      ];

      const propertiesMap = new Map<number, string>();
      if (propIds.length > 0) {
        const propRows = await db
          .select({ id: properties.id, propertyName: properties.propertyName })
          .from(properties)
          .where(inArray(properties.id, propIds));
        propRows.forEach(p => propertiesMap.set(p.id, p.propertyName));
      }

      const byPropertyMap = new Map<
        number,
        { propertyId: number; propertyName: string; activeRfpCount: number; totalTiValue: number }
      >();
      for (const rfp of activeRfps) {
        if (rfp.propertyId === null || rfp.propertyId === undefined) continue;
        const tiVal = parseTiValue(rfp.estimatedValue);
        const existing = byPropertyMap.get(rfp.propertyId);
        if (existing) {
          existing.activeRfpCount++;
          existing.totalTiValue += tiVal;
        } else {
          byPropertyMap.set(rfp.propertyId, {
            propertyId: rfp.propertyId,
            propertyName: propertiesMap.get(rfp.propertyId) ?? 'Unknown',
            activeRfpCount: 1,
            totalTiValue: tiVal,
          });
        }
      }
      const byProperty = [...byPropertyMap.values()].sort((a, b) => b.totalTiValue - a.totalTiValue);

      // --- 7. largestActiveDeal ---
      let largestActiveDeal: {
        id: number; rfpNumber: string; tenantName: string;
        propertyId: number | null; propertyName: string | null; estimatedValue: string | null;
      } | null = null;

      if (activeRfps.length > 0) {
        const withValues = activeRfps.map(r => ({ ...r, _parsed: parseTiValue(r.estimatedValue) }));
        const maxParsed = Math.max(...withValues.map(r => r._parsed));
        if (maxParsed > 0) {
          const top = withValues.find(r => r._parsed === maxParsed)!;
          largestActiveDeal = {
            id: top.id,
            rfpNumber: top.rfpNumber,
            tenantName: top.tenantName,
            propertyId: top.propertyId ?? null,
            propertyName: top.propertyId != null ? (propertiesMap.get(top.propertyId) ?? null) : null,
            estimatedValue: top.estimatedValue ?? null,
          };
        }
      }

      // --- 8 & 9. avgCostPerSf current and prior year ---
      const actualsRows = await db
        .select({ completedDate: projectActuals.completedDate, costPerSf: projectActuals.costPerSf })
        .from(projectActuals)
        .where(isNotNull(projectActuals.completedDate));

      const avgCsf = (rows: { completedDate: Date | null; costPerSf: string | null }[]): number | null => {
        const vals = rows.map(r => parseTiValue(r.costPerSf)).filter(v => v > 0);
        if (vals.length === 0) return null;
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      };

      const currentYearActuals = actualsRows.filter(r => r.completedDate?.getFullYear() === currentYear);
      const priorYearActuals = actualsRows.filter(r => r.completedDate?.getFullYear() === priorYear);

      const avgCostPerSfCurrentYear = avgCsf(currentYearActuals);
      const avgCostPerSfPriorYear = avgCsf(priorYearActuals);

      // --- 10. yoyDeltaPct ---
      const yoyDeltaPct =
        avgCostPerSfCurrentYear !== null && avgCostPerSfPriorYear !== null && avgCostPerSfPriorYear !== 0
          ? Math.round(((avgCostPerSfCurrentYear - avgCostPerSfPriorYear) / avgCostPerSfPriorYear) * 1000) / 10
          : null;

      // --- 11. Velocity: completed in last 90 days ---
      const velocityRows = await db
        .select({ completedDate: rfpRequests.completedDate, receivedOn: rfpRequests.receivedOn })
        .from(rfpRequests)
        .where(
          and(
            eq(rfpRequests.status, 'completed'),
            isNotNull(rfpRequests.completedDate),
            isNotNull(rfpRequests.receivedOn),
            gte(rfpRequests.completedDate, ninetyDaysAgo)
          )
        );

      const velocityDays = velocityRows
        .map(r => Math.floor((r.completedDate!.getTime() - r.receivedOn!.getTime()) / 86400000))
        .filter(d => d >= 0);

      const sampleSize = velocityDays.length;
      const avgDaysReceivedToCompleted =
        sampleSize > 0
          ? Math.round((velocityDays.reduce((s, d) => s + d, 0) / sampleSize) * 10) / 10
          : null;

      // --- 12. mostActiveProperty ---
      const mostActiveProperty =
        byProperty.length > 0
          ? byProperty.reduce((best, cur) => (cur.activeRfpCount > best.activeRfpCount ? cur : best))
          : null;

      res.json({
        attentionRequired: {
          overdueRfps,
          bidsAwaitingEvaluation,
          upcomingDeadlines,
        },
        pipeline: {
          totalActiveTiValue,
          activeRfpCount,
          byProperty,
          largestActiveDeal,
        },
        portfolioIntelligence: {
          avgCostPerSfCurrentYear,
          avgCostPerSfPriorYear,
          yoyDeltaPct,
          velocity: {
            avgDaysReceivedToCompleted,
            sampleSize,
            note: 'Computed from completedDate as proxy for evaluation completion',
          },
          mostActiveProperty: mostActiveProperty
            ? {
                propertyId: mostActiveProperty.propertyId,
                propertyName: mostActiveProperty.propertyName,
                activeRfpCount: mostActiveProperty.activeRfpCount,
              }
            : null,
        },
      });
    } catch (err: any) {
      console.error('Dashboard metrics error:', err);
      res.status(500).json({ error: err?.message ?? 'Unknown error' });
    }
  });
}
