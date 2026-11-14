import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return (
    <RoleTabs
      role="ADMIN"
      tabs={[
        { name: 'scan', title: 'Scan', icon: 'scan-outline' },
        { name: 'parcels', title: 'Parcels', icon: 'cube-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-outline' },
      ]}
    />
  );
}
