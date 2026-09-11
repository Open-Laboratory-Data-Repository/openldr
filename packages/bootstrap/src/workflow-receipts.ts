import { createWorkflowReceiptService } from '@openldr/workflows';

/** HTTP and CLI share receipt acceptance and status through bootstrap. */
export const createWebhookReceiptService = createWorkflowReceiptService;
