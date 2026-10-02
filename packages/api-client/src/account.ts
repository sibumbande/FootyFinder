import type {
  AccountDeletionPreview,
  AccountDeletionScheduled,
  ConfirmAccountDeletionInput,
  DataExportInput,
  PersonalDataExport,
} from '@footy-finder/shared';
import type { ApiClient } from './client.js';

/** CEO batch 5: the player's own account (delete my account, download my data). */
export const accountApi = (client: ApiClient) => ({
  deletionPreview: () =>
    client.request<{ data: AccountDeletionPreview }>('/account/deletion/preview'),
  requestDeletion: (input: ConfirmAccountDeletionInput) =>
    client.request<{ data: AccountDeletionScheduled }>('/account/deletion', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  downloadData: (input: DataExportInput) =>
    client.request<{ data: PersonalDataExport }>('/account/data-export', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
