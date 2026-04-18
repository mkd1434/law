/**
 * 법령/행정규칙 모니터링 tRPC 라우터
 * 모니터링 대상 및 변경 로그 관리 API
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, publicProcedure, router } from '../_core/trpc';
import {
  getMonitoredItems,
  addMonitoredItem,
  updateMonitoredItem,
  deleteMonitoredItem,
  getChangeLogs,
  addChangeLog,
  updateChangeLog,
} from '../db';
import { runSyncJob } from '../jobs/syncMonitor';

export const monitoringRouter = router({
  /**
   * 모니터링 대상 목록 조회
   */
  getMonitoredItems: publicProcedure
    .input(
      z.object({
        type: z.enum(['law', 'rule']).optional(),
        isActive: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      try {
        console.log('[monitoringRouter] Fetching monitored items with input:', input);
        const items = await getMonitoredItems({
          type: input?.type,
          isActive: input?.isActive,
        });
        console.log('[monitoringRouter] Successfully fetched items:', items?.length || 0);
        return items || [];
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error fetching monitored items:', errorMsg);
        console.error('[monitoringRouter] Full error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch monitored items: ${errorMsg}`,
        });
      }
    }),

  /**
   * 모니터링 대상 추가 (관리자만)
   */
  addMonitoredItem: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, '이름은 필수입니다'),
        type: z.enum(['law', 'rule']),
        externalId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 모니터링 대상을 추가할 수 있습니다',
        });
      }

      try {
        await addMonitoredItem({
          name: input.name,
          type: input.type,
          externalId: input.externalId,
          isActive: 1,
        });

        return { success: true, message: '모니터링 대상이 추가되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error adding monitored item:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '모니터링 대상 추가에 실패했습니다',
        });
      }
    }),

  /**
   * 모니터링 대상 업데이트 (관리자만)
   */
  updateMonitoredItem: protectedProcedure
    .input(
      z.object({
        id: z.number().min(1),
        name: z.string().optional(),
        isActive: z.boolean().optional(),
        externalId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 모니터링 대상을 수정할 수 있습니다',
        });
      }

      try {
        const updates: any = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.isActive !== undefined) updates.isActive = input.isActive ? 1 : 0;
        if (input.externalId !== undefined) updates.externalId = input.externalId;

        await updateMonitoredItem(input.id, updates);
        return { success: true, message: '모니터링 대상이 수정되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error updating monitored item:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '모니터링 대상 수정에 실패했습니다',
        });
      }
    }),

  /**
   * 모니터링 대상 삭제 (관리자만)
   */
  deleteMonitoredItem: protectedProcedure
    .input(z.object({ id: z.number().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 모니터링 대상을 삭제할 수 있습니다',
        });
      }

      try {
        await deleteMonitoredItem(input.id);
        return { success: true, message: '모니터링 대상이 삭제되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error deleting monitored item:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '모니터링 대상 삭제에 실패했습니다',
        });
      }
    }),

  /**
   * 변경 로그 조회
   */
  getChangeLogs: publicProcedure
    .input(
      z.object({
        itemId: z.number().optional(),
        status: z.enum(['current', 'upcoming']).optional(),
        limit: z.number().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      try {
        const logs = await getChangeLogs({
          itemId: input?.itemId,
          status: input?.status,
          limit: input?.limit || 100,
        });

        const items = (await getMonitoredItems()) as any[];
        const itemById = new Map<number, { name: string; type: 'law' | 'rule' }>();
        for (const item of items) {
          const id = Number(item.id);
          if (!Number.isFinite(id)) continue;
          itemById.set(id, { name: item.name, type: item.type });
        }

        const enrichedLogs = (logs || []).map((log: any) => {
          const id = Number(log.itemId);
          const meta = Number.isFinite(id) ? itemById.get(id) : undefined;
          return {
            ...log,
            itemId: Number.isFinite(id) ? id : log.itemId,
            lawName: meta?.name ?? '미지정',
            monitoredType: meta?.type ?? null,
          };
        });

        return enrichedLogs;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error fetching change logs:', errorMsg);
        if (error && typeof error === 'object' && 'cause' in error) {
          console.error('[monitoringRouter] cause:', (error as any).cause);
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '변경 로그 조회에 실패했습니다',
        });
      }
    }),

  /**
   * 변경 로그 생성 (관리자/시스템만)
   */
  createChangeLog: protectedProcedure
    .input(
      z.object({
        itemId: z.number().min(1),
        announcementNo: z.string().min(1),
        effectiveDate: z.date(),
        status: z.enum(['current', 'upcoming']),
        comparisonData: z.any().optional(),
        content: z.string().optional(),
        rawData: z.any().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 변경 로그를 생성할 수 있습니다',
        });
      }

      try {
        await addChangeLog({
          itemId: input.itemId,
          announcementNo: input.announcementNo,
          effectiveDate: input.effectiveDate,
          status: input.status,
          comparisonData: input.comparisonData,
          content: input.content,
          rawData: input.rawData,
        });

        return { success: true, message: '변경 로그가 생성되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error creating change log:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '변경 로그 생성에 실패했습니다',
        });
      }
    }),

  /**
   * 변경 로그 업데이트 (관리자만)
   */
  updateChangeLog: protectedProcedure
    .input(
      z.object({
        id: z.number().min(1),
        status: z.enum(['current', 'upcoming']).optional(),
        comparisonData: z.any().optional(),
        content: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 변경 로그를 수정할 수 있습니다',
        });
      }

      try {
        const updates: any = {};
        if (input.status !== undefined) updates.status = input.status;
        if (input.comparisonData !== undefined) updates.comparisonData = input.comparisonData;
        if (input.content !== undefined) updates.content = input.content;

        await updateChangeLog(input.id, updates);
        return { success: true, message: '변경 로그가 수정되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[monitoringRouter] Error updating change log:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '변경 로그 수정에 실패했습니다',
        });
      }
    }),

  /**
   * 동기화 작업 실행 (관리자만)
   * 모든 활성화된 모니터링 대상에 대해 변동 감지 및 수집 수행
   */
  runSync: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '관리자만 동기화 작업을 실행할 수 있습니다',
        });
      }

      try {
        console.log('[monitoringRouter] Starting sync job...');
        await runSyncJob();
        return { success: true, message: '동기화 작업이 완료되었습니다' };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[monitoringRouter] Sync job failed:', errorMsg);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `동기화 작업 실패: ${errorMsg}`,
        });
      }
    }),
});
