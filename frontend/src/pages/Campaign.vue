<template>
  <LayoutHeader>
    <template #left-header>
      <Breadcrumbs :items="breadcrumbs" />
    </template>
    <template v-if="doc" #right-header>
      <span v-if="doc.synced_at" class="text-sm text-ink-gray-5">
        {{ __('Last synced') }} {{ timeAgo(doc.synced_at) }}
      </span>
      <Badge
        v-if="doc.status"
        :label="capitalize(displayStatus)"
        :theme="STATUS_COLOR[displayStatus] || 'gray'"
        variant="subtle"
        size="md"
      >
        <template #prefix>
          <!-- parseColor turns the raw color name into a Tailwind
               text-color class so IndicatorIcon's stroke="currentColor"
               actually paints. Without it the dot inherits dark. -->
          <IndicatorIcon :class="parseColor(STATUS_COLOR[displayStatus] || 'gray')" />
        </template>
      </Badge>
      <!-- Module 2 cadence controls: one button shows per state, gated on
           the same admin flag as Refresh. Backend enforces the same gate +
           validates the transition, so this is purely UX hiding. -->
      <Button
        v-if="autokloseAdminFlag && cadenceAction"
        :label="cadenceAction.label"
        :icon-left="cadenceAction.icon"
        :theme="cadenceAction.theme"
        variant="solid"
        :loading="cadenceBusy"
        @click="openCadenceConfirm(cadenceAction)"
      />
      <Button
        v-if="autokloseAdminFlag"
        :label="__('Refresh now')"
        icon-left="refresh-cw"
        :loading="refreshing"
        @click="onRefresh"
      />
      <!-- Module 3c — Delete / Request deletion / Withdraw request.
           Backend `get_user_deletion_capability` decides which of the
           three buttons makes sense for the current caller; we just
           render whichever one is non-null. Backend re-enforces the
           gate on click so this is purely UX hiding. -->
      <Button
        v-if="deletionAction"
        :label="deletionAction.label"
        :icon-left="deletionAction.icon"
        :theme="deletionAction.theme"
        :variant="deletionAction.variant || 'subtle'"
        :loading="deletionBusy"
        @click="deletionAction.onClick"
      />
    </template>
  </LayoutHeader>

  <!-- Module 3c — admin-only banner when a pending deletion request
       exists. Inline Approve / Reject controls let the admin act
       without leaving the campaign detail page. Other admins see the
       same banner; first-acter wins (the loser gets a clean
       "already resolved" error). -->
  <div
    v-if="doc && deletionCap?.is_admin && deletionCap?.pending_request_for_campaign"
    class="mx-5 mt-3 rounded-md border border-outline-amber-2 bg-surface-amber-1 px-4 py-3"
  >
    <div class="flex items-start gap-3">
      <FeatherIcon name="alert-circle" class="h-4 w-4 mt-1 text-ink-amber-7 shrink-0" />
      <div class="flex-1 text-sm text-ink-gray-9">
        <div class="font-medium">
          {{ __('Pending deletion request') }}
        </div>
        <div class="mt-1 text-ink-gray-7">
          {{ __('From') }}
          <span class="font-medium">{{ deletionCap.pending_request_for_campaign.requested_by }}</span>
          <span v-if="deletionCap.pending_request_for_campaign.reason">
            — {{ deletionCap.pending_request_for_campaign.reason }}
          </span>
          <span class="ml-2 text-xs text-ink-gray-5">
            ({{ timeAgo(deletionCap.pending_request_for_campaign.requested_at) }})
          </span>
        </div>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button
          variant="subtle"
          size="sm"
          :label="__('Reject')"
          :loading="rejectingRequest"
          @click="openRejectDialog(deletionCap.pending_request_for_campaign)"
        />
        <Button
          variant="solid"
          theme="red"
          size="sm"
          :label="__('Approve + delete')"
          :loading="approvingRequest"
          @click="openApproveDialog(deletionCap.pending_request_for_campaign)"
        />
      </div>
    </div>
  </div>

  <div
    v-if="campaign.loading && !doc"
    class="flex h-full items-center justify-center text-ink-gray-5"
  >
    {{ __('Loading campaign…') }}
  </div>

  <Tabs
    v-else-if="doc"
    v-model="tabIndex"
    :tabs="tabs"
    class="flex-1 overflow-hidden flex flex-col"
  >
    <template #tab-panel="{ tab }">
      <!-- =================== OVERVIEW =================== -->
      <div
        v-if="tab.name === 'overview'"
        class="overflow-auto px-5 py-4 space-y-6"
      >
        <DetailSection :label="__('Campaign')">
          <DetailField :label="__('Name')" :value="doc.campaign_name" />
          <DetailField :label="__('Campaign ID')" :value="doc.campaign_id" />
          <DetailField :label="__('Status')" :value="capitalize(doc.status)" />
          <DetailField :label="__('Autoklose user ID')" :value="doc.autoklose_user_id" />
          <DetailField :label="__('Email account ID')" :value="doc.email_account_id" />
          <DetailField
            :label="__('Automated')"
            :value="doc.is_automated ? __('Yes') : __('No')"
          />
        </DetailSection>

        <DetailSection :label="__('Schedule')">
          <DetailField :label="__('Start date')" :value="formatDate(doc.start_date)" />
          <DetailField :label="__('End date')" :value="formatDate(doc.end_date) || '—'" />
          <DetailField :label="__('Emails per day')" :value="doc.emails_per_day" />
          <DetailField :label="__('Timezone')" :value="doc.timezone" />
          <DetailField :label="__('Work hours')" :value="workHoursDisplay" />
          <DetailField :label="__('Sending days')" :value="sendingDaysDisplay" />
        </DetailSection>

        <DetailSection :label="__('Tracking')">
          <DetailField
            :label="__('Track opens')"
            :value="doc.track_open ? __('Enabled') : __('Disabled')"
          />
          <DetailField
            :label="__('Track clicks')"
            :value="doc.track_click ? __('Enabled') : __('Disabled')"
          />
          <DetailField
            :label="__('Track replies')"
            :value="doc.track_reply ? __('Enabled') : __('Disabled')"
          />
          <DetailField
            :label="__('Track attachments')"
            :value="doc.track_attachment ? __('Enabled') : __('Disabled')"
          />
        </DetailSection>
      </div>

      <!-- =================== SEQUENCE =================== -->
      <!-- Module 3 — Editable sequence. Admins see Add / Edit / Delete
           controls; non-admins fall back to the read-only Module 1
           view. -->
      <div
        v-else-if="tab.name === 'sequence'"
        class="overflow-auto px-5 py-4 space-y-4"
      >
        <!-- Header row: step count + Add (admin-only). Always rendered
             so the count is visible even when there are zero steps. -->
        <div class="flex items-center justify-between">
          <div class="text-sm text-ink-gray-5">
            {{ doc.sequence_steps?.length || 0 }}
            {{ __('step(s)') }}
          </div>
          <Button
            v-if="autokloseAdminFlag"
            variant="solid"
            theme="blue"
            icon-left="plus"
            :label="__('Add step')"
            @click="openCreateStep()"
          />
        </div>

        <div
          v-if="!doc.sequence_steps?.length"
          class="text-sm text-ink-gray-5"
        >
          {{ __('No sequence steps defined for this campaign.') }}
        </div>
        <div
          v-for="step in sortedSteps"
          :key="step.name"
          class="rounded border border-outline-gray-1 p-4"
        >
          <div class="flex items-baseline justify-between gap-3">
            <div class="flex items-baseline gap-3">
              <span class="text-base font-medium text-ink-gray-9">
                {{ (step.position || 0) + 1 }}.
                {{ step.step_name || __('Email') }}
              </span>
              <span class="text-sm text-ink-gray-5">
                {{ __('Send after') }} {{ step.send_after_days }}
                {{ __('day(s)') }}
              </span>
            </div>
            <!-- Per-step admin actions. Edit opens the StepEditorModal
                 pre-seeded with this step; Delete pops a confirm
                 dialog with explicit Cancel + red destructive CTA. -->
            <div v-if="autokloseAdminFlag" class="flex shrink-0 gap-2">
              <Button
                variant="subtle"
                size="sm"
                icon-left="edit-2"
                :label="__('Edit')"
                @click="openEditStep(step)"
              />
              <Button
                variant="subtle"
                theme="red"
                size="sm"
                icon-left="trash-2"
                :label="__('Delete')"
                @click="openDeleteStep(step)"
              />
            </div>
          </div>
          <div v-if="step.subject" class="mt-2 text-sm">
            <span class="text-ink-gray-5">{{ __('Subject') }}:</span>
            <span class="ml-2 text-ink-gray-9">{{ step.subject }}</span>
          </div>
          <div
            v-if="step.body_html"
            class="mt-3 rounded bg-surface-gray-1 p-3 text-sm text-ink-gray-8 max-h-96 overflow-auto prose-sm"
            v-html="sanitizeHTML(step.body_html)"
          />
        </div>
      </div>

      <!-- =================== RECIPIENTS =================== -->
      <div
        v-else-if="tab.name === 'recipients'"
        class="flex flex-col overflow-hidden"
      >
        <div
          class="flex items-center justify-between border-b px-5 py-2 text-sm text-ink-gray-7"
        >
          <span>
            {{ __('Total') }}: {{ recipients.data?.length || 0 }}
            <span v-if="recipientsTotal != null">
              / {{ recipientsTotal }}
            </span>
          </span>
          <div class="flex items-center gap-2">
            <!-- Module 8 — CSV export. Backend enforces _require_push_role,
                 so showing this unconditionally is fine; non-Autoklose
                 users would get a 403 on click (rare, since they wouldn't
                 reach this page anyway — the Campaigns route is gated). -->
            <Button
              :label="__('Export CSV')"
              icon-left="download"
              variant="subtle"
              theme="gray"
              size="sm"
              @click="onExportRecipientsCsv"
            />
            <Button
              v-if="recipients.hasNextPage"
              :label="__('Load more')"
              variant="subtle"
              size="sm"
              :loading="recipients.loading"
              @click="recipients.next()"
            />
          </div>
        </div>
        <div
          v-if="recipients.loading && !recipients.data?.length"
          class="p-6 text-sm text-ink-gray-5"
        >
          {{ __('Loading recipients…') }}
        </div>
        <div
          v-else-if="!recipients.data?.length"
          class="p-6 text-sm text-ink-gray-5"
        >
          {{ __('No recipients visible to you for this campaign.') }}
        </div>
        <div v-else class="overflow-auto">
          <table class="w-full text-sm">
            <thead
              class="sticky top-0 bg-surface-white border-b text-ink-gray-7"
            >
              <tr>
                <th class="text-left px-5 py-2 font-medium">{{ __('Email') }}</th>
                <th class="text-left px-3 py-2 font-medium">{{ __('Lead') }}</th>
                <th class="text-left px-3 py-2 font-medium">
                  {{ __('First contacted') }}
                </th>
                <th class="text-left px-3 py-2 font-medium">
                  {{ __('Last contacted') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in recipients.data"
                :key="r.name"
                class="border-b hover:bg-surface-menu-bar"
              >
                <td class="px-5 py-2 text-ink-gray-9">{{ r.email || '—' }}</td>
                <td class="px-3 py-2">
                  <router-link
                    v-if="r.lead"
                    :to="{ name: 'Lead', params: { leadId: r.lead } }"
                    class="text-ink-blue-link hover:underline"
                  >
                    {{ r.lead }}
                  </router-link>
                  <span v-else class="text-ink-gray-4">—</span>
                </td>
                <td class="px-3 py-2 text-ink-gray-7">
                  {{ formatDate(r.first_contacted_at) || '—' }}
                </td>
                <td class="px-3 py-2 text-ink-gray-7">
                  {{ formatDate(r.last_contacted_at) || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- =================== ENGAGEMENT =================== -->
      <div
        v-else-if="tab.name === 'engagement'"
        class="overflow-auto px-5 py-4 space-y-6"
      >
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            :label="__('Recipients')"
            :value="doc.stats_recipients_total ?? 0"
          />
          <StatCard :label="__('Pending')" :value="doc.stats_pending ?? 0" />
          <StatCard
            :label="__('Emails sent')"
            :value="doc.stats_emails_sent ?? 0"
          />
          <StatCard
            :label="__('Bounced')"
            :value="doc.stats_emails_bounced ?? 0"
          />
          <StatCard :label="__('Total opens')" :value="doc.stats_total_opened ?? 0" />
          <StatCard :label="__('Unique opens')" :value="doc.stats_unique_opened ?? 0" />
          <StatCard :label="__('Total clicks')" :value="doc.stats_total_clicks ?? 0" />
          <StatCard
            :label="__('Unique clicks')"
            :value="doc.stats_unique_clicks ?? 0"
          />
          <StatCard
            class="col-span-2"
            :label="__('Replies')"
            :value="doc.stats_total_replied ?? 0"
          />
        </div>

        <div>
          <div class="mb-2 text-sm font-medium text-ink-gray-9">
            {{ __('Funnel') }}
          </div>
          <div class="space-y-1.5">
            <FunnelBar
              v-for="step in funnelSteps"
              :key="step.label"
              :label="step.label"
              :value="step.value"
              :max="funnelMax"
              :color="step.color"
            />
          </div>
          <div class="mt-2 text-xs text-ink-gray-5">
            {{ __('Bars are scaled relative to the recipients total.') }}
          </div>
        </div>

        <!-- Module 8 — Per-step engagement breakdown.
             One row per sequence step, with stats pulled from
             /campaigns/{cid}/emails/{step_id}/statistics. Loading shows
             a single inline line so the funnel above stays readable;
             empty state when the campaign has no steps OR every fetch
             failed (we still render rows in that case but with em-dashes). -->
        <div>
          <div class="mb-2 text-sm font-medium text-ink-gray-9">
            {{ __('Per-step breakdown') }}
          </div>
          <div
            v-if="perStepStats.loading && !perStepStats.data"
            class="text-sm text-ink-gray-5"
          >
            {{ __('Loading per-step stats…') }}
          </div>
          <div
            v-else-if="!perStepStats.data?.length"
            class="text-sm text-ink-gray-5"
          >
            {{ __('No step stats available.') }}
          </div>
          <div v-else class="overflow-auto">
            <table class="w-full text-sm">
              <thead
                class="border-b text-ink-gray-7"
              >
                <tr>
                  <th class="text-left px-3 py-2 font-medium">
                    {{ __('Step') }}
                  </th>
                  <th class="text-left px-3 py-2 font-medium">
                    {{ __('Subject') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Send after') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Sent') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Unique opens') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Unique clicks') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Replied') }}
                  </th>
                  <th class="text-right px-3 py-2 font-medium">
                    {{ __('Bounced') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in perStepStats.data"
                  :key="row.step_id || row.position"
                  class="border-b hover:bg-surface-menu-bar"
                >
                  <td class="px-3 py-2 text-ink-gray-9 tabular-nums">
                    {{ (row.position || 0) + 1 }}
                  </td>
                  <td class="px-3 py-2 text-ink-gray-9 truncate max-w-[24rem]">
                    {{ row.subject || '—' }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-7 tabular-nums">
                    {{ row.send_after_days ?? 0 }}
                    {{ __('d') }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-9 tabular-nums">
                    {{ row.emails_sent ?? '—' }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-9 tabular-nums">
                    {{ row.unique_opened ?? '—' }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-9 tabular-nums">
                    {{ row.unique_clicks ?? '—' }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-9 tabular-nums">
                    {{ row.total_replied ?? '—' }}
                  </td>
                  <td class="px-3 py-2 text-right text-ink-gray-9 tabular-nums">
                    {{ row.emails_bounced ?? '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </Tabs>

  <!-- Final fallback: doc didn't load AND we're no longer loading. Covers
       both error paths (PermissionError when a non-Autoklose user types
       the URL directly, or any other 4xx/5xx from frappe.client.get) and
       genuinely-empty edge cases. Without this, the page would render
       blank — see Item #4 round 1 H2 report. -->
  <div
    v-else
    class="flex h-full items-center justify-center px-8 text-center text-ink-gray-7"
  >
    <div>
      <div class="text-base font-medium">
        {{ __('Could not load campaign') }}
      </div>
      <div v-if="loadError" class="mt-1 text-sm">{{ loadError }}</div>
      <div v-else class="mt-1 text-sm">
        {{ __("You may not have access to this campaign, or it doesn't exist.") }}
      </div>
    </div>
  </div>

  <!-- Module 2 — Cadence confirmation dialog. Reused for Start / Pause /
       Resume; the pendingCadence ref carries which action the admin
       clicked. Single dialog keeps the markup simple and avoids three
       parallel v-models. -->
  <Dialog
    v-model="cadenceConfirmOpen"
    :options="{
      title: pendingCadence?.confirmTitle || '',
      size: 'sm',
      actions: [
        {
          label: pendingCadence?.confirmCta || __('Confirm'),
          variant: 'solid',
          theme: pendingCadence?.theme || 'blue',
          loading: cadenceBusy,
          onClick: runPendingCadence,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{ pendingCadence?.confirmBody }}
      </p>
      <p v-if="doc" class="mt-3 text-sm text-ink-gray-9">
        <span class="text-ink-gray-5">{{ __('Campaign') }}:</span>
        <span class="ml-1 font-medium">{{ doc.campaign_name || doc.name }}</span>
      </p>
    </template>
  </Dialog>

  <!-- Module 3 — Sequence step editor (create + edit). Mounted only
       when open so the inner form's `reactive` state resets cleanly
       on each open. The same modal handles both modes; `editingStep`
       being null toggles into create mode internally. -->
  <StepEditorModal
    v-if="stepEditorOpen"
    v-model="stepEditorOpen"
    :step="editingStep"
    :campaign-id="props.campaignId"
    @saved="onStepSaved"
  />

  <!-- Module 3 — Delete-step confirm dialog. Red destructive CTA +
       explicit Cancel; closes on success or when the user dismisses. -->
  <Dialog
    v-model="deleteStepConfirmOpen"
    :options="{
      title: __('Delete this sequence step?'),
      size: 'sm',
      actions: [
        {
          label: __('Delete step'),
          variant: 'solid',
          theme: 'red',
          loading: deletingStep,
          onClick: runDeleteStep,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            'Autoklose will remove this email from the campaign sequence. ' +
              'Recipients who have not yet reached this step will skip it; ' +
              'recipients already past it are unaffected.',
          )
        }}
      </p>
      <p v-if="pendingDeleteStep" class="mt-3 text-sm text-ink-gray-9">
        <span class="text-ink-gray-5">{{ __('Step') }}:</span>
        <span class="ml-1 font-medium">
          {{ (pendingDeleteStep.position || 0) + 1 }}.
          {{ pendingDeleteStep.subject || pendingDeleteStep.step_name || __('Email') }}
        </span>
      </p>
    </template>
  </Dialog>

  <!-- =================== Module 3c modals =================== -->

  <!-- Tier 1/2 direct delete -->
  <Dialog
    v-model="deleteConfirmOpen"
    :options="{
      title: __('Delete this campaign?'),
      size: 'sm',
      actions: [
        {
          label: __('Delete campaign'),
          variant: 'solid',
          theme: 'red',
          loading: deletionBusy,
          onClick: runDelete,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            'Permanently removes the campaign from Autoklose AND the CRM ' +
              'cache. Recipients, sequence steps, and engagement history ' +
              'are removed too. This cannot be undone.',
          )
        }}
      </p>
      <p v-if="doc" class="mt-3 text-sm text-ink-gray-9">
        <span class="text-ink-gray-5">{{ __('Campaign') }}:</span>
        <span class="ml-1 font-medium">{{ doc.campaign_name || doc.name }}</span>
      </p>
      <div class="mt-3">
        <label class="mb-1 block text-xs font-medium text-ink-gray-7">
          {{ __('Reason (optional, for audit)') }}
        </label>
        <textarea
          v-model="deleteReason"
          class="w-full rounded border border-outline-gray-2 p-2 text-sm"
          rows="2"
        />
      </div>
    </template>
  </Dialog>

  <!-- Tier 3: request deletion -->
  <Dialog
    v-model="requestDialogOpen"
    :options="{
      title: __('Request campaign deletion?'),
      size: 'sm',
      actions: [
        {
          label: __('Submit request'),
          variant: 'solid',
          theme: 'red',
          loading: deletionBusy,
          onClick: runRequest,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            "You don't have permission to delete campaigns directly. " +
              'An admin will review your request and approve or reject it.',
          )
        }}
      </p>
      <div class="mt-3">
        <label class="mb-1 block text-xs font-medium text-ink-gray-7">
          {{ __('Reason') }}
        </label>
        <textarea
          v-model="requestReason"
          class="w-full rounded border border-outline-gray-2 p-2 text-sm"
          :placeholder="__('Why should this campaign be deleted?')"
          rows="3"
        />
      </div>
    </template>
  </Dialog>

  <!-- Tier 3: withdraw a pending request -->
  <Dialog
    v-model="withdrawDialogOpen"
    :options="{
      title: __('Withdraw deletion request?'),
      size: 'sm',
      actions: [
        {
          label: __('Withdraw request'),
          variant: 'solid',
          theme: 'gray',
          loading: deletionBusy,
          onClick: runWithdraw,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            'Your pending deletion request will be withdrawn. The campaign ' +
              'remains in place; you can submit a fresh request later if needed.',
          )
        }}
      </p>
    </template>
  </Dialog>

  <!-- Admin: approve a pending request -->
  <Dialog
    v-model="approveDialogOpen"
    :options="{
      title: __('Approve + delete this campaign?'),
      size: 'sm',
      actions: [
        {
          label: __('Approve + delete'),
          variant: 'solid',
          theme: 'red',
          loading: approvingRequest,
          onClick: runApprove,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            'Approving the request immediately deletes the campaign from ' +
              'Autoklose and the CRM cache. Recipients, steps, and ' +
              'engagement history are removed. This cannot be undone.',
          )
        }}
      </p>
      <p v-if="pendingApprove" class="mt-3 text-sm text-ink-gray-9">
        <span class="text-ink-gray-5">{{ __('Requested by') }}:</span>
        <span class="ml-1 font-medium">{{ pendingApprove.requested_by }}</span>
        <span v-if="pendingApprove.reason" class="block text-ink-gray-7 mt-1">
          {{ __('Reason') }}: {{ pendingApprove.reason }}
        </span>
      </p>
    </template>
  </Dialog>

  <!-- Admin: reject a pending request -->
  <Dialog
    v-model="rejectDialogOpen"
    :options="{
      title: __('Reject this deletion request?'),
      size: 'sm',
      actions: [
        {
          label: __('Reject request'),
          variant: 'solid',
          theme: 'gray',
          loading: rejectingRequest,
          onClick: runReject,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <p class="text-sm text-ink-gray-7">
        {{
          __(
            'The campaign stays in place. The requester sees the rejection ' +
              'on their next page load.',
          )
        }}
      </p>
      <div class="mt-3">
        <label class="mb-1 block text-xs font-medium text-ink-gray-7">
          {{ __('Note to requester (optional)') }}
        </label>
        <textarea
          v-model="rejectNote"
          class="w-full rounded border border-outline-gray-2 p-2 text-sm"
          :placeholder="__('e.g. campaign is still active, please pause first')"
          rows="3"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import IndicatorIcon from '@/components/Icons/IndicatorIcon.vue'
import LayoutHeader from '@/components/LayoutHeader.vue'
import StepEditorModal from '@/components/Modals/StepEditorModal.vue'
import {
  Badge,
  Breadcrumbs,
  Button,
  Dialog,
  FeatherIcon,
  Tabs,
  call,
  createDocumentResource,
  createListResource,
  createResource,
  toast,
} from 'frappe-ui'
import { sanitizeHTML, formatDate, timeAgo, parseColor } from '@/utils'
import { useRoute, useRouter } from 'vue-router'
import { computed, h, ref, watch } from 'vue'

const props = defineProps({
  campaignId: { type: String, required: true },
})

const route = useRoute()
const router = useRouter()

// Status color map for the badge + cadence buttons.
//
// `in_progress` is the documented Autoklose API value for "running"; the
// /campaigns list endpoint historically returns `active` for the same
// state. We map both to green and treat them as synonyms in displayStatus
// below. `pending` shows up briefly while Autoklose is provisioning a
// scheduled start — render as orange (transitional) rather than green so
// it visibly differs from the running state.
const STATUS_COLOR = {
  active: 'green',
  in_progress: 'green',
  pending: 'orange',
  paused: 'orange',
  draft: 'gray',
  finished: 'blue',
  archived: 'gray',
}

const breadcrumbs = computed(() => [
  { label: __('Campaigns'), route: { name: 'Campaigns' } },
  { label: doc.value?.campaign_name || props.campaignId, route: null },
])

// ----- Campaign doc resource -----------------------------------------------
const campaign = createDocumentResource({
  doctype: 'Autoklose Campaign',
  name: props.campaignId,
  auto: true,
})
const doc = computed(() => campaign.doc)
const loadError = computed(() => {
  const e = campaign.error
  if (!e) return ''
  return e.messages?.join(', ') || e.message || String(e)
})

// Canonical "running" string for the UI. Autoklose returns both `active`
// (list endpoint) and `in_progress` (status endpoint) for the same state;
// the badge + cadence button logic uses this so we don't have to OR-check
// both everywhere.
const displayStatus = computed(() => {
  const s = (doc.value?.status || '').toLowerCase()
  return s === 'in_progress' ? 'active' : s
})

// ----- Recipients (paginated child list) -----------------------------------
const recipients = createListResource({
  doctype: 'Autoklose Recipient',
  fields: [
    'name',
    'email',
    'lead',
    'first_contacted_at',
    'last_contacted_at',
  ],
  filters: { campaign: props.campaignId },
  pageLength: 50,
  orderBy: 'last_contacted_at desc',
  auto: true,
})
const recipientsCount = createResource({
  url: 'frappe.client.get_count',
  params: {
    doctype: 'Autoklose Recipient',
    filters: { campaign: props.campaignId },
  },
  auto: true,
})
const recipientsTotal = computed(() => recipientsCount.data ?? null)

// ----- Module 8 — Reporting polish ----------------------------------------
//
// Per-step engagement breakdown (Engagement tab) + CSV export for the
// Recipients tab. Kept in one block so it's obvious which additions are
// Module 8.
const perStepStats = createResource({
  url: 'firmadapt_crm.integrations.autoklose.reporting.get_per_step_stats',
  params: { campaign_id: props.campaignId },
  auto: true,
})

function onExportRecipientsCsv() {
  // The backend method sets frappe.response.type = "download" so the
  // browser fires a file save when we navigate to the method URL. A
  // simple window.open() in the same tab triggers the download without
  // leaving an empty tab open — Chrome treats it as a navigation that
  // resolves to an attachment.
  const url =
    '/api/method/firmadapt_crm.integrations.autoklose.reporting.export_recipients_csv' +
    '?campaign_id=' +
    encodeURIComponent(props.campaignId)
  window.location.href = url
}

// ----- Tabs ----------------------------------------------------------------
const tabs = [
  { name: 'overview', label: __('Overview') },
  { name: 'sequence', label: __('Sequence') },
  { name: 'recipients', label: __('Recipients') },
  { name: 'engagement', label: __('Engagement') },
]
function tabIndexFromHash() {
  const hashName = (route.hash || '').replace(/^#/, '') || 'overview'
  const i = tabs.findIndex((t) => t.name === hashName)
  return i === -1 ? 0 : i
}
const tabIndex = ref(tabIndexFromHash())
watch(tabIndex, (i) => {
  const name = tabs[i]?.name
  if (!name) return
  localStorage.setItem('lastCampaignTab', name)
  // router.push (not replace) so each tab click adds a history entry —
  // browser back/forward cycles through tabs as the test plan expects.
  // The route.hash watcher below skips re-triggering this on hash echo.
  if (route.hash !== '#' + name) {
    router.push({ ...route, hash: '#' + name })
  }
})
watch(
  () => route.hash,
  () => {
    const i = tabIndexFromHash()
    if (i !== tabIndex.value) tabIndex.value = i
  },
)

// ----- Refresh-now button (admin-only) -------------------------------------
const autokloseAdminFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_admin',
  auto: true,
  onSuccess: (v) => (autokloseAdminFlag.value = !!v),
  onError: () => (autokloseAdminFlag.value = false),
})
const refreshing = ref(false)
async function onRefresh() {
  refreshing.value = true
  try {
    // refresh_one lives in the sync module, not api — api.refresh_campaigns
    // exists for the legacy push-button flow but doesn't accept a single
    // campaign_id. The sync.refresh_one path is what we want.
    await call('firmadapt_crm.integrations.autoklose.sync.refresh_one', {
      campaign_id: props.campaignId,
    })
    campaign.reload()
    recipients.reload()
    recipientsCount.reload()
    // toast.create takes { message, type } — not { title, text }. Earlier
    // shape rendered an empty toast box with no content.
    toast.create({
      message: __('Campaign re-synced from Autoklose.'),
      type: 'success',
    })
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        e?._server_messages ||
        __('Refresh failed.'),
      type: 'error',
    })
  } finally {
    refreshing.value = false
  }
}

// ----- Module 2: Cadence controls (Pause / Resume / Start) -----------------
//
// One button slot in the header; which action shows depends on the current
// campaign status (only admins see anything — autokloseAdminFlag gates the
// whole block in the template). Click → confirm dialog → backend PATCH →
// re-sync via the existing campaign.reload() pipeline so the badge + tabs
// pick up the new state immediately.
//
// We deliberately don't surface archive / finished transitions from the
// CRM — those are higher-impact and should stay in the Autoklose UI.
// Anything outside draft / active / paused renders no button (e.g.
// archived campaigns are read-only from here).
const cadenceAction = computed(() => {
  const s = displayStatus.value
  if (s === 'active') {
    return {
      key: 'pause',
      apiStatus: 'paused',
      label: __('Pause'),
      icon: 'pause',
      // frappe-ui Button only supports themes gray|blue|green|red. We
      // semantically want "warning orange" here (matches the Paused
      // status badge, which the Badge component *does* render orange),
      // but Button silently falls through to unstyled for unknown
      // themes. Map to `red` — closest valid theme conveying "this
      // halts an outbound process." Resume/Start stay green (positive
      // action).
      theme: 'red',
      confirmTitle: __('Pause this campaign?'),
      confirmBody: __(
        'Autoklose will stop sending emails for this campaign until it is resumed. In-flight sends already queued may still go out.',
      ),
      confirmCta: __('Pause campaign'),
      successMessage: __('Campaign paused.'),
    }
  }
  if (s === 'paused') {
    return {
      key: 'resume',
      apiStatus: 'in_progress',
      label: __('Resume'),
      icon: 'play',
      theme: 'green',
      confirmTitle: __('Resume this campaign?'),
      confirmBody: __(
        'Autoklose will pick up sending where it left off and follow the configured schedule + sending days.',
      ),
      confirmCta: __('Resume campaign'),
      successMessage: __('Campaign resumed.'),
    }
  }
  if (s === 'draft') {
    return {
      key: 'start',
      apiStatus: 'in_progress',
      label: __('Start'),
      icon: 'play',
      theme: 'green',
      confirmTitle: __('Start this campaign?'),
      confirmBody: __(
        'Autoklose will begin sending emails to recipients according to the schedule + sequence configured on this campaign.',
      ),
      confirmCta: __('Start campaign'),
      successMessage: __('Campaign started.'),
    }
  }
  // finished / archived / unknown — no button rendered.
  return null
})

const cadenceConfirmOpen = ref(false)
const pendingCadence = ref(null)
const cadenceBusy = ref(false)

function openCadenceConfirm(action) {
  pendingCadence.value = action
  cadenceConfirmOpen.value = true
}

async function runPendingCadence() {
  const action = pendingCadence.value
  if (!action) return
  cadenceBusy.value = true
  try {
    await call(
      'firmadapt_crm.integrations.autoklose.api.set_campaign_status',
      {
        campaign_id: props.campaignId,
        status: action.apiStatus,
      },
    )
    // Re-sync the doc + recipients so the UI reflects the new state.
    // set_campaign_status calls refresh_campaign_detail internally, so
    // the cached row is fresh — reload() just pulls the latest local
    // values. recipients.reload() isn't strictly needed (status flips
    // don't change recipient set) but keeps things consistent if
    // Autoklose's auto-pause-on-add-recipient kicks in.
    campaign.reload()
    recipients.reload()
    recipientsCount.reload()
    toast.create({ message: action.successMessage, type: 'success' })
    cadenceConfirmOpen.value = false
    pendingCadence.value = null
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        e?._server_messages ||
        __('Status change failed.'),
      type: 'error',
    })
  } finally {
    cadenceBusy.value = false
  }
}

// ----- Module 3: Sequence step authoring (Add / Edit / Delete) -------------
//
// Add / Edit share one modal (StepEditorModal). editingStep === null is the
// CREATE signal; otherwise the step row is passed in to pre-seed the form.
// onStepSaved triggers a reload — the backend already called
// refresh_campaign_detail so the local cache is fresh; campaign.reload()
// just pulls the latest values into the SPA's doc resource.
//
// Delete uses a separate confirm Dialog rather than $dialog so we get
// the same `loading` UX during the API call that the cadence dialog has.
const stepEditorOpen = ref(false)
const editingStep = ref(null)

function openCreateStep() {
  editingStep.value = null
  stepEditorOpen.value = true
}
function openEditStep(step) {
  editingStep.value = step
  stepEditorOpen.value = true
}
function onStepSaved() {
  stepEditorOpen.value = false
  editingStep.value = null
  campaign.reload()
}

const deleteStepConfirmOpen = ref(false)
const pendingDeleteStep = ref(null)
const deletingStep = ref(false)

function openDeleteStep(step) {
  pendingDeleteStep.value = step
  deleteStepConfirmOpen.value = true
}

async function runDeleteStep() {
  const step = pendingDeleteStep.value
  if (!step?.step_id) return
  deletingStep.value = true
  try {
    await call(
      'firmadapt_crm.integrations.autoklose.step_authoring.delete_step',
      {
        campaign_id: props.campaignId,
        step_id: step.step_id,
      },
    )
    campaign.reload()
    toast.create({
      message: __('Sequence step deleted.'),
      type: 'success',
    })
    deleteStepConfirmOpen.value = false
    pendingDeleteStep.value = null
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        e?._server_messages ||
        __('Delete failed.'),
      type: 'error',
    })
  } finally {
    deletingStep.value = false
  }
}

// ----- Module 3c: Campaign deletion + request workflow --------------------
//
// Three-tier permission model. Backend `get_user_deletion_capability`
// returns flags + any pending-request info; we render the right
// button + (admin-only) the pending-request banner.

const deletionCap = ref(null)
const deletionCapResource = createResource({
  url: 'firmadapt_crm.integrations.autoklose.campaign_deletion.get_user_deletion_capability',
  auto: false,
  onSuccess: (data) => {
    deletionCap.value = data
  },
})
function refreshDeletionCap() {
  deletionCapResource.update({
    params: { campaign_id: props.campaignId },
  })
  deletionCapResource.fetch()
}
watch(
  () => props.campaignId,
  (id) => {
    if (id) refreshDeletionCap()
  },
  { immediate: true },
)

const deletionBusy = ref(false)

// One of three things shows up depending on capability + pending state.
// Returns `null` to suppress rendering entirely (e.g. caller has no
// Autoklose role at all).
const deletionAction = computed(() => {
  const cap = deletionCap.value
  if (!cap) return null
  // Tier 1/2 — direct delete. Pending request (if any) is shown
  // separately in the admin banner; the button always says Delete.
  if (cap.can_delete) {
    return {
      key: 'delete',
      label: __('Delete'),
      icon: 'trash-2',
      theme: 'red',
      variant: 'subtle',
      onClick: openDeleteDialog,
    }
  }
  // Tier 3 with an existing pending request — show Withdraw.
  if (cap.pending_request_for_user) {
    return {
      key: 'withdraw',
      label: __('Withdraw request'),
      icon: 'rotate-ccw',
      theme: 'gray',
      variant: 'subtle',
      onClick: openWithdrawDialog,
    }
  }
  // Tier 3 — submit a request.
  if (cap.can_request) {
    return {
      key: 'request',
      label: __('Request deletion'),
      icon: 'trash-2',
      theme: 'red',
      variant: 'subtle',
      onClick: openRequestDialog,
    }
  }
  return null
})

// ---- Direct delete (tier 1/2) ----
const deleteConfirmOpen = ref(false)
const deleteReason = ref('')
function openDeleteDialog() {
  deleteReason.value = ''
  deleteConfirmOpen.value = true
}
async function runDelete() {
  deletionBusy.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.autoklose.campaign_deletion.delete_campaign',
      {
        campaign_id: props.campaignId,
        reason: deleteReason.value || '',
      },
    )
    toast.create({
      message: __("Campaign '{0}' deleted.", [
        resp?.campaign_name || props.campaignId,
      ]),
      type: 'success',
    })
    deleteConfirmOpen.value = false
    // Navigate back to the list — the doc no longer exists here.
    router.push({ name: 'Campaigns', params: { viewType: 'list' } })
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Delete failed.'),
      type: 'error',
    })
  } finally {
    deletionBusy.value = false
  }
}

// ---- Request deletion (tier 3) ----
const requestDialogOpen = ref(false)
const requestReason = ref('')
function openRequestDialog() {
  requestReason.value = ''
  requestDialogOpen.value = true
}
async function runRequest() {
  deletionBusy.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.autoklose.campaign_deletion.request_campaign_deletion',
      {
        campaign_id: props.campaignId,
        reason: requestReason.value || '',
      },
    )
    toast.create({
      message: resp?.already_existed
        ? __('You already have a pending request for this campaign.')
        : __('Deletion request submitted. An admin will review it.'),
      type: 'success',
    })
    requestDialogOpen.value = false
    refreshDeletionCap()
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Request failed.'),
      type: 'error',
    })
  } finally {
    deletionBusy.value = false
  }
}

// ---- Withdraw request (tier 3, owner-only) ----
const withdrawDialogOpen = ref(false)
function openWithdrawDialog() {
  withdrawDialogOpen.value = true
}
async function runWithdraw() {
  const rn = deletionCap.value?.pending_request_for_user?.name
  if (!rn) return
  deletionBusy.value = true
  try {
    await call(
      'firmadapt_crm.integrations.autoklose.campaign_deletion.withdraw_campaign_deletion_request',
      { request_name: rn },
    )
    toast.create({
      message: __('Request withdrawn.'),
      type: 'success',
    })
    withdrawDialogOpen.value = false
    refreshDeletionCap()
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Withdraw failed.'),
      type: 'error',
    })
  } finally {
    deletionBusy.value = false
  }
}

// ---- Admin: approve / reject a pending request ----
const approveDialogOpen = ref(false)
const approvingRequest = ref(false)
const pendingApprove = ref(null)
function openApproveDialog(req) {
  pendingApprove.value = req
  approveDialogOpen.value = true
}
async function runApprove() {
  const req = pendingApprove.value
  if (!req) return
  approvingRequest.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.autoklose.campaign_deletion.approve_campaign_deletion_request',
      { request_name: req.name },
    )
    toast.create({
      message: __("Approved + deleted campaign '{0}'.", [
        resp?.campaign_name || props.campaignId,
      ]),
      type: 'success',
    })
    approveDialogOpen.value = false
    router.push({ name: 'Campaigns', params: { viewType: 'list' } })
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Approve failed.'),
      type: 'error',
    })
  } finally {
    approvingRequest.value = false
  }
}

const rejectDialogOpen = ref(false)
const rejectingRequest = ref(false)
const pendingReject = ref(null)
const rejectNote = ref('')
function openRejectDialog(req) {
  pendingReject.value = req
  rejectNote.value = ''
  rejectDialogOpen.value = true
}
async function runReject() {
  const req = pendingReject.value
  if (!req) return
  rejectingRequest.value = true
  try {
    await call(
      'firmadapt_crm.integrations.autoklose.campaign_deletion.reject_campaign_deletion_request',
      {
        request_name: req.name,
        admin_note: rejectNote.value || '',
      },
    )
    toast.create({
      message: __('Request rejected.'),
      type: 'success',
    })
    rejectDialogOpen.value = false
    refreshDeletionCap()
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Reject failed.'),
      type: 'error',
    })
  } finally {
    rejectingRequest.value = false
  }
}

// ----- Display helpers -----------------------------------------------------
function capitalize(s) {
  if (!s || typeof s !== 'string') return s ?? ''
  return s[0].toUpperCase() + s.slice(1)
}

const sortedSteps = computed(() => {
  const steps = doc.value?.sequence_steps || []
  return [...steps].sort((a, b) => (a.position || 0) - (b.position || 0))
})

const workHoursDisplay = computed(() => {
  const from = doc.value?.work_hours_from
  const to = doc.value?.work_hours_to
  if (!from && !to) return '—'
  return `${from || '—'} – ${to || '—'}`
})

// Autoklose sends sending_days as { Monday: true, Tuesday: true, ... } —
// capitalized full-day names. Normalize by lowercasing keys before lookup
// so we don't re-break if Autoklose ever switches to 'monday' / 'mon'.
const sendingDaysDisplay = computed(() => {
  const raw = doc.value?.sending_days
  if (!raw) return '—'
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return typeof raw === 'string' ? raw : '—'
  }
  if (!parsed || typeof parsed !== 'object') return '—'
  const norm = {}
  for (const k of Object.keys(parsed)) {
    norm[String(k).toLowerCase()] = parsed[k]
  }
  const order = [
    ['monday',    'Mon'],
    ['tuesday',   'Tue'],
    ['wednesday', 'Wed'],
    ['thursday',  'Thu'],
    ['friday',    'Fri'],
    ['saturday',  'Sat'],
    ['sunday',    'Sun'],
  ]
  const enabled = order
    .filter(([k]) => norm[k] || norm[k.slice(0, 3)])
    .map(([, label]) => label)
  return enabled.length ? enabled.join(', ') : '—'
})

// ----- Funnel chart (CSS bars; frappe-charts isn't installed and a
// recipient→sent→opened→clicked→replied funnel doesn't need a real chart
// library — just proportional bars relative to the recipients total) ------
const funnelSteps = computed(() => {
  const d = doc.value || {}
  return [
    { label: __('Recipients'),    value: d.stats_recipients_total ?? 0,   color: 'gray'   },
    { label: __('Emails sent'),   value: d.stats_emails_sent ?? 0,        color: 'blue'   },
    { label: __('Unique opens'),  value: d.stats_unique_opened ?? 0,      color: 'green'  },
    { label: __('Unique clicks'), value: d.stats_unique_clicks ?? 0,      color: 'purple' },
    { label: __('Replies'),       value: d.stats_total_replied ?? 0,      color: 'orange' },
    { label: __('Bounced'),       value: d.stats_emails_bounced ?? 0,     color: 'red'    },
  ]
})
const funnelMax = computed(
  () => doc.value?.stats_recipients_total || 1,
)

// ----- Inline mini-components for tab content ------------------------------
// Kept inline (h() factories) to keep this page self-contained instead of
// scattering 4 helper .vue files for trivial label/value rendering.
const DetailSection = {
  props: { label: { type: String, required: true } },
  setup(p, { slots }) {
    return () =>
      h('div', { class: 'rounded border border-outline-gray-1 p-4' }, [
        h(
          'div',
          { class: 'mb-3 text-sm font-medium text-ink-gray-9' },
          p.label,
        ),
        h(
          'div',
          { class: 'grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2' },
          slots.default?.(),
        ),
      ])
  },
}
const DetailField = {
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number, Boolean], default: '' },
  },
  setup(p) {
    return () =>
      h('div', { class: 'flex justify-between gap-3 text-sm' }, [
        h('span', { class: 'text-ink-gray-5' }, p.label),
        h(
          'span',
          { class: 'text-right text-ink-gray-9 truncate' },
          p.value === '' || p.value == null ? '—' : String(p.value),
        ),
      ])
  },
}
const StatCard = {
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number], required: true },
  },
  setup(p) {
    return () =>
      h(
        'div',
        { class: 'rounded border border-outline-gray-1 px-4 py-3' },
        [
          h(
            'div',
            { class: 'text-xs text-ink-gray-5' },
            p.label,
          ),
          h(
            'div',
            { class: 'mt-1 text-xl font-semibold text-ink-gray-9' },
            String(p.value),
          ),
        ],
      )
  },
}
const FunnelBar = {
  props: {
    label: { type: String, required: true },
    value: { type: Number, required: true },
    max: { type: Number, required: true },
    color: { type: String, default: 'blue' },
  },
  setup(p) {
    // bg-surface-pink-3 / -purple-3 aren't defined in frappe-ui's surface
    // tokens (only -1 is), so they render transparent. Tailwind's base
    // palette is always available and gives us a usable tint here.
    const colorBg = {
      gray: 'bg-surface-gray-3',
      blue: 'bg-surface-blue-3',
      green: 'bg-surface-green-3',
      purple: 'bg-violet-300',
      orange: 'bg-surface-amber-3',
      red: 'bg-surface-red-3',
    }
    return () => {
      const pct = p.max > 0 ? Math.min(100, (p.value / p.max) * 100) : 0
      return h('div', { class: 'flex items-center gap-3 text-sm' }, [
        h(
          'div',
          { class: 'w-32 text-ink-gray-7 truncate' },
          p.label,
        ),
        h(
          'div',
          { class: 'flex-1 h-6 rounded bg-surface-gray-1 relative overflow-hidden' },
          [
            h('div', {
              class: `h-full ${colorBg[p.color] || 'bg-surface-blue-3'}`,
              style: `width: ${pct}%;`,
            }),
          ],
        ),
        h(
          'div',
          { class: 'w-20 text-right text-ink-gray-9 tabular-nums' },
          String(p.value),
        ),
      ])
    }
  },
}
</script>
