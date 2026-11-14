import { RoleTabs } from '../../src/navigation';
import { GiveawayProvider } from '../../src/screens/operator/Giveaway';

export default function Layout() {
  return (
    <GiveawayProvider>
      <RoleTabs
        role="ADMIN"
        tabs={[
          { name: 'scan', title: 'Scan', icon: 'scan-outline' },
          { name: 'giveaway', title: 'Giveaway', icon: 'hand-left-outline' },
          { name: 'parcels', title: 'Parcels', icon: 'cube-outline' },
          { name: 'profile', title: 'Profile', icon: 'person-outline' },
        ]}
      />
    </GiveawayProvider>
  );
}
