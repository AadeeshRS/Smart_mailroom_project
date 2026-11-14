import { RoleTabs } from '../../src/navigation';
import { usePushNotifications } from '../../src/push';

export default function Layout() {
  usePushNotifications();
  return (
    <RoleTabs
      role="MEMBER"
      tabs={[
        { name: 'index', title: 'Home', icon: 'home-outline' },
        { name: 'requests', title: 'Requests', icon: 'list-outline' },
        { name: 'history', title: 'Past', icon: 'time-outline' },
        { name: 'profile', title: 'Profile', icon: 'person-outline' },
      ]}
    />
  );
}
