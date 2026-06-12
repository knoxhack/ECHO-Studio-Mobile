import { useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Chip, Dialog, Divider, IconButton, Portal, Surface, Text, TextInput, useTheme } from 'react-native-paper'
import type { EchoMobileProject } from './mobileTypes'

export function ScreenFrame({
  title,
  subtitle,
  actions,
  children
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="headlineSmall">{title}</Text>
          {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  )
}

export function ProjectStrip({
  project,
  compact = false
}: {
  project: EchoMobileProject | null
  compact?: boolean
}) {
  if (!project) {
    return (
      <Surface mode="flat" style={styles.strip}>
        <Text>No project selected</Text>
      </Surface>
    )
  }
  return (
    <Surface mode="flat" style={styles.strip}>
      <View style={styles.rowWrap}>
        <Chip compact icon="folder">{project.manifest.name}</Chip>
        <Chip compact icon={project.dirty ? 'circle-edit-outline' : 'check-circle-outline'}>
          {project.dirty ? 'Dirty' : 'Synced'}
        </Chip>
        <Chip compact icon="shield-check">
          {project.lastValidation?.compatibilityScore ?? 0}%
        </Chip>
        {!compact && project.github ? (
          <Chip compact icon="github">{project.github.owner}/{project.github.repo}</Chip>
        ) : null}
      </View>
    </Surface>
  )
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction
}: {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Surface mode="flat" style={styles.empty}>
      <Text variant="titleMedium">{title}</Text>
      {body ? <Text style={styles.muted}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button mode="contained" icon="plus" onPress={onAction} style={styles.topGap}>
          {actionLabel}
        </Button>
      ) : null}
    </Surface>
  )
}

export function StatusBanner({
  title,
  body,
  tone = 'neutral',
  actionLabel,
  onAction
}: {
  title: string
  body?: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Surface mode="flat" style={[styles.banner, styles[`banner_${tone}`]]}>
      <View style={styles.recordText}>
        <Text variant="titleSmall">{title}</Text>
        {body ? <Text style={styles.muted}>{body}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Button mode="contained-tonal" compact onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Surface>
  )
}

export function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string | number
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  const theme = useTheme()
  const color =
    tone === 'good'
      ? '#63d47c'
      : tone === 'warn'
        ? theme.colors.secondary
        : tone === 'bad'
          ? theme.colors.error
          : theme.colors.primary
  return (
    <Surface mode="flat" style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text variant="headlineSmall" style={{ color }}>{value}</Text>
    </Surface>
  )
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

export function Field({
  label,
  value,
  onChangeText,
  multiline,
  secureTextEntry,
  keyboardType
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  multiline?: boolean
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'numeric' | 'url'
}) {
  return (
    <TextInput
      mode="outlined"
      dense
      label={label}
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      style={styles.field}
    />
  )
}

export function PillRow({
  items,
  selected,
  onToggle,
  multi = false
}: {
  items: Array<{ key: string; label: string; icon?: string }>
  selected: string[]
  onToggle: (key: string) => void
  multi?: boolean
}) {
  return (
    <View style={styles.rowWrap}>
      {items.map((item) => {
        const active = selected.includes(item.key)
        return (
          <Chip
            key={item.key}
            icon={item.icon}
            selected={active}
            showSelectedOverlay
            onPress={() => {
              if (!multi && active) return
              onToggle(item.key)
            }}
          >
            {item.label}
          </Chip>
        )
      })}
    </View>
  )
}

export function ViewTabs({
  title,
  items,
  selected,
  onSelect
}: {
  title?: string
  items: Array<{ key: string; label: string; icon?: string }>
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <Surface mode="flat" style={styles.navPanel}>
      {title ? <Text style={styles.metricLabel}>{title}</Text> : null}
      <View style={styles.rowWrap}>
        {items.map((item) => (
          <Chip
            key={item.key}
            icon={item.icon}
            selected={selected === item.key}
            showSelectedOverlay
            onPress={() => onSelect(item.key)}
          >
            {item.label}
          </Chip>
        ))}
      </View>
    </Surface>
  )
}

export function ConfirmAction({
  label,
  icon,
  mode = 'outlined',
  compact,
  disabled,
  confirmTitle,
  confirmBody,
  onConfirm
}: {
  label: string
  icon?: string
  mode?: 'text' | 'outlined' | 'contained' | 'elevated' | 'contained-tonal'
  compact?: boolean
  disabled?: boolean
  confirmTitle: string
  confirmBody: string
  onConfirm: () => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <>
      <Button compact={compact} mode={mode} icon={icon} disabled={disabled} onPress={() => setVisible(true)}>
        {label}
      </Button>
      <Portal>
        <Dialog visible={visible} onDismiss={() => setVisible(false)}>
          <Dialog.Title>{confirmTitle}</Dialog.Title>
          <Dialog.Content>
            <Text>{confirmBody}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setVisible(false)}>Cancel</Button>
            <Button
              mode="contained"
              onPress={() => {
                setVisible(false)
                onConfirm()
              }}
            >
              Confirm
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  )
}

export function RecordCard({
  title,
  subtitle,
  selected,
  right,
  onPress,
  onDelete
}: {
  title: string
  subtitle?: string
  selected?: boolean
  right?: ReactNode
  onPress?: () => void
  onDelete?: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <>
      <Card mode={selected ? 'elevated' : 'contained'} style={[styles.recordCard, selected ? styles.selectedCard : null]} onPress={onPress}>
        <Card.Content style={styles.recordContent}>
          <View style={styles.recordText}>
            <Text variant="titleSmall">{title}</Text>
            {subtitle ? <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text> : null}
          </View>
          {right ? <View style={styles.recordRight}>{right}</View> : null}
          {onDelete ? <IconButton icon="delete-outline" size={20} onPress={() => setConfirmDelete(true)} /> : null}
        </Card.Content>
      </Card>
      <Portal>
        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Delete item?</Dialog.Title>
          <Dialog.Content>
            <Text>This removes {title} from the local project.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              mode="contained"
              onPress={() => {
                setConfirmDelete(false)
                onDelete?.()
              }}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  )
}

export function Hairline() {
  return <Divider style={styles.divider} />
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#071018'
  },
  screenContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 32
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  headerText: {
    flex: 1,
    gap: 4
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  muted: {
    color: '#9fb2bf'
  },
  strip: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#0d1721'
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center'
  },
  empty: {
    padding: 18,
    borderRadius: 8,
    backgroundColor: '#101d28',
    gap: 8
  },
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 10,
    backgroundColor: '#101d28'
  },
  banner_good: {
    borderColor: '#2c6d46',
    borderWidth: 1
  },
  banner_warn: {
    borderColor: '#8f6d2b',
    borderWidth: 1
  },
  banner_bad: {
    borderColor: '#8a3b42',
    borderWidth: 1
  },
  banner_neutral: {
    borderColor: '#243747',
    borderWidth: 1
  },
  topGap: {
    marginTop: 8,
    alignSelf: 'flex-start'
  },
  metric: {
    flex: 1,
    minWidth: 132,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#101d28'
  },
  metricLabel: {
    color: '#9fb2bf',
    fontSize: 12,
    marginBottom: 4
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  navPanel: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#0d1721',
    gap: 8
  },
  section: {
    gap: 10
  },
  sectionTitle: {
    marginTop: 4
  },
  field: {
    marginBottom: 8,
    backgroundColor: '#0d1721'
  },
  recordCard: {
    marginBottom: 8,
    backgroundColor: '#101d28'
  },
  selectedCard: {
    borderColor: '#41d6c3',
    borderWidth: 1
  },
  recordContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8
  },
  recordText: {
    flex: 1,
    minWidth: 160,
    gap: 2
  },
  recordRight: {
    maxWidth: '100%',
    flexShrink: 1
  },
  divider: {
    backgroundColor: '#243747',
    marginVertical: 4
  }
})
