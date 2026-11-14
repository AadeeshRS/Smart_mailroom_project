import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return (
    <RoleTabs
      role="MEMBER"
      tabs={[
        { name: 'index', title: 'Home', icon: 'home-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-outline' },
      ]}
    />
  );
}
