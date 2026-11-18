import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return (
    <RoleTabs
      role="ADMIN"
      tabs={[
        { name: 'dashboard', title: 'Dashboard', icon: 'stats-chart-outline' },
        { name: 'scan', title: 'Scan', icon: 'scan-outline' },
        { name: 'giveaway', title: 'Giveaway', icon: 'hand-left-outline' },
        { name: 'parcels', title: 'Parcels', icon: 'cube-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-outline' },
      ]}
    />
  );
}
